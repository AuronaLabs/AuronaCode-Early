import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export type FileNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  isOpen?: boolean;
};

const PATH_SEPARATOR_PATTERN = /[/\\]+/;

export const FileSystemService = {
  joinPath(parentPath: string, childName: string) {
    return `${parentPath.replace(/[\\/]+$/, "")}/${childName.replace(/^[\\/]+/, "")}`;
  },

  dirname(path: string) {
    const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return index > 0 ? path.slice(0, index) : path;
  },

  basename(path: string) {
    return path.split(PATH_SEPARATOR_PATTERN).filter(Boolean).pop() || path;
  },

  validateName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return "名称不能为空";
    if (/[\\/]/.test(trimmed)) return "名称不能包含路径分隔符";
    if (/^[. ]+$/.test(trimmed)) return "名称不能只包含点或空格";
    if (/[<>:"|?*]/.test(trimmed)) return "名称包含 Windows 不支持的字符";
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(trimmed)) return "名称为 Windows 保留字";
    return null;
  },

  toMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|denied|forbidden|not allowed/i.test(message)) {
      return "没有权限完成此文件操作";
    }
    if (/exists|already/i.test(message)) {
      return "目标已存在";
    }
    if (/not found|cannot find/i.test(message)) {
      return "文件或文件夹不存在";
    }
    return message || "未知文件系统错误";
  },

  async readDirectory(dirPath: string): Promise<FileNode[]> {
    const entries = await readDir(dirPath);
    const nodes = entries.map((entry) => ({
      name: entry.name || "Unknown",
      path: this.joinPath(dirPath, entry.name || "Unknown"),
      isDirectory: entry.isDirectory,
    }));

    return nodes.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
      }
      return a.isDirectory ? -1 : 1;
    });
  },

  async createFile(parentPath: string, name: string) {
    const validation = this.validateName(name);
    if (validation) throw new Error(validation);

    const targetPath = this.joinPath(parentPath, name.trim());
    if (await exists(targetPath)) throw new Error("目标已存在");

    await writeTextFile(targetPath, "");
    return targetPath;
  },

  async createFolder(parentPath: string, name: string) {
    const validation = this.validateName(name);
    if (validation) throw new Error(validation);

    const targetPath = this.joinPath(parentPath, name.trim());
    if (await exists(targetPath)) throw new Error("目标已存在");

    await mkdir(targetPath);
    return targetPath;
  },

  async renameEntry(oldPath: string, newName: string) {
    const validation = this.validateName(newName);
    if (validation) throw new Error(validation);

    const parentPath = this.dirname(oldPath);
    const newPath = this.joinPath(parentPath, newName.trim());
    if (oldPath === newPath) return newPath;
    if (await exists(newPath)) throw new Error("目标已存在");

    await rename(oldPath, newPath);
    return newPath;
  },

  async deleteEntry(path: string, isDirectory: boolean) {
    await remove(path, { recursive: isDirectory });
  },

  readTextFile,
  writeTextFile,

  async writeTextFileAtomic(path: string, content: string) {
    const tmpPath = `${path}.aurona.tmp`;
    const bakPath = `${path}.aurona.bak`;
    try {
      await writeTextFile(tmpPath, content);
      
      const fileExists = await exists(path);
      if (fileExists) {
        if (await exists(bakPath)) {
          await remove(bakPath).catch(() => {});
        }
        await rename(path, bakPath);
      }
      
      await rename(tmpPath, path);
      
      if (fileExists) {
        await remove(bakPath).catch(() => {});
      }
    } catch (error) {
      await remove(tmpPath).catch(() => {});
      if (await exists(bakPath)) {
        await rename(bakPath, path).catch(() => {});
      }
      throw error;
    }
  },
};
