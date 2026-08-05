import { FileSystemService } from "./FileSystemService";
import { WorkspaceService } from "./WorkspaceService";

export interface DebugConfiguration {
  name: string;
  type: string;
  request: "launch" | "attach";
  command?: string;
  adapterArgs?: string[];
  program?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stopOnEntry?: boolean;
  [key: string]: unknown;
}

export interface DebugConfigurationFile {
  version: "0.1.0";
  configurations: DebugConfiguration[];
}

export interface DebugConfigurationApplicability {
  supported: boolean;
  reason?: string;
  targetPath?: string;
  followsActiveFile: boolean;
}

const VARIABLE_PATTERN =
  /\$\{(workspaceFolder|file|fileDirname|fileBasename|relativeFile|env:[A-Za-z_][A-Za-z0-9_]*)\}/g;

function substitute(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(VARIABLE_PATTERN, (token, name: string) => variables[name] ?? token);
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, variables)]),
    );
  }
  return value;
}

const TYPE_EXTENSIONS: Record<string, readonly string[]> = {
  python: [".py", ".pyw"],
  node: [".js", ".mjs", ".cjs"],
};

function extensionOf(path: string): string {
  const name = FileSystemService.basename(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export const DebugConfigurationService = {
  getConfigurationPath(): string | null {
    const root = WorkspaceService.getCurrent().primaryRoot;
    return root ? FileSystemService.joinPath(root, ".aurona/launch.json") : null;
  },

  async load(activeFile?: string): Promise<DebugConfiguration[]> {
    const path = this.getConfigurationPath();
    if (!path) return [];
    if (!(await FileSystemService.exists(path))) {
      await this.createDetectedConfiguration(path, activeFile);
    }
    if (!(await FileSystemService.exists(path))) return [];
    const parsed = JSON.parse(
      await FileSystemService.readTextFile(path),
    ) as Partial<DebugConfigurationFile>;
    if (parsed.version !== "0.1.0" || !Array.isArray(parsed.configurations)) {
      throw new Error("Invalid .aurona/launch.json: expected version 0.1.0 and configurations[]");
    }
    return parsed.configurations.filter((item): item is DebugConfiguration =>
      Boolean(item?.name && item?.type && ["launch", "attach"].includes(item.request)),
    );
  },

  async createDetectedConfiguration(path: string, activeFile?: string): Promise<void> {
    const root = WorkspaceService.getCurrent().primaryRoot;
    if (!root) return;
    const isPythonFile = activeFile?.toLowerCase().endsWith(".py") ?? false;
    const pythonMarkers = ["pyproject.toml", "requirements.txt", "main.py"];
    const isPythonWorkspace =
      isPythonFile ||
      (
        await Promise.all(
          pythonMarkers.map((name) =>
            FileSystemService.exists(FileSystemService.joinPath(root, name)),
          ),
        )
      ).some(Boolean);
    if (!isPythonWorkspace) return;

    const directory = FileSystemService.dirname(path);
    await FileSystemService.mkdir(directory, true);
    const configuration: DebugConfigurationFile = {
      version: "0.1.0",
      configurations: [
        {
          name: "Python：当前文件",
          type: "python",
          request: "launch",
          program: `$${"{file}"}`,
          cwd: `$${"{workspaceFolder}"}`,
          stopOnEntry: false,
          justMyCode: true,
        },
      ],
    };
    await FileSystemService.writeTextFile(path, `${JSON.stringify(configuration, null, 2)}\n`);
  },

  resolve(configuration: DebugConfiguration, activeFile?: string): DebugConfiguration {
    const root = WorkspaceService.getCurrent().primaryRoot ?? "";
    const file = activeFile ?? "";
    const normalizedRoot = root.replace(/\\/g, "/");
    const normalizedFile = file.replace(/\\/g, "/");
    const relativeFile = normalizedFile.startsWith(`${normalizedRoot}/`)
      ? normalizedFile.slice(normalizedRoot.length + 1)
      : normalizedFile;
    const variables: Record<string, string> = {
      workspaceFolder: root,
      file,
      fileDirname: file ? FileSystemService.dirname(file) : "",
      fileBasename: file ? FileSystemService.basename(file) : "",
      relativeFile,
    };
    for (const [name, value] of Object.entries(import.meta.env)) {
      if (typeof value === "string") variables[`env:${name}`] = value;
    }
    return substitute(configuration, variables) as DebugConfiguration;
  },

  getApplicability(
    configuration: DebugConfiguration,
    activeFile?: string,
  ): DebugConfigurationApplicability {
    if (configuration.request === "attach") {
      return { supported: true, followsActiveFile: false };
    }
    if (typeof configuration.program !== "string" || configuration.program.trim() === "") {
      return {
        supported: false,
        reason: "此启动配置没有指定 program",
        followsActiveFile: false,
      };
    }

    const followsActiveFile = /\$\{(?:file|fileDirname|fileBasename|relativeFile)\}/.test(
      configuration.program,
    );
    if (followsActiveFile && !activeFile) {
      return {
        supported: false,
        reason: "当前没有活动代码文件",
        followsActiveFile,
      };
    }

    const resolved = this.resolve(configuration, activeFile);
    const targetPath = typeof resolved.program === "string" ? resolved.program : undefined;
    if (!targetPath || /\$\{[^}]+\}/.test(targetPath)) {
      return {
        supported: false,
        reason: "启动文件包含无法解析的变量",
        targetPath,
        followsActiveFile,
      };
    }

    const supportedExtensions = TYPE_EXTENSIONS[configuration.type];
    if (supportedExtensions && !supportedExtensions.includes(extensionOf(targetPath))) {
      return {
        supported: false,
        reason: `${configuration.type} 调试不支持 ${extensionOf(targetPath) || "无扩展名文件"}`,
        targetPath,
        followsActiveFile,
      };
    }

    return { supported: true, targetPath, followsActiveFile };
  },

  async resolveForLaunch(
    configuration: DebugConfiguration,
    activeFile?: string,
  ): Promise<DebugConfiguration> {
    const applicability = this.getApplicability(configuration, activeFile);
    if (!applicability.supported) {
      throw new Error(applicability.reason ?? "当前调试配置不适用于活动文件");
    }
    const resolved = this.resolve(configuration, activeFile);
    if (configuration.request === "launch" && typeof resolved.program === "string") {
      const root = WorkspaceService.getCurrent().primaryRoot ?? "";
      const cwd = typeof resolved.cwd === "string" ? resolved.cwd : root;
      const program = /^[A-Za-z]:[\\/]|^[/\\]{2}|^\//.test(resolved.program)
        ? resolved.program
        : FileSystemService.joinPath(cwd, resolved.program);
      if (!(await FileSystemService.exists(program))) {
        throw new Error(`调试目标文件不存在：${program}`);
      }
      resolved.program = program;
    }
    return resolved;
  },
};
