import { EventBus } from "../Foundation/EventBus";
import { FileSystemCommands } from "../Foundation/IPC/FileSystemCommands";
import { WorkspaceService } from "./WorkspaceService";

export type FileNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  isOpen?: boolean;
};

const PATH_SEPARATOR_PATTERN = /[/\\]+/;

let activeWatchId: string | null = null;
let changedUnlistenPromise: Promise<() => void> | null = null;

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
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(trimmed))
      return "名称为 Windows 保留字";
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

  async setWorkspaceRoot(root: string | null): Promise<void> {
    await FileSystemCommands.setWorkspaceRoot(root);
  },

  async readDirectory(dirPath: string): Promise<FileNode[]> {
    const entries = await FileSystemCommands.readDirectory(dirPath);
    const nodes = entries.map((entry) => ({
      name: entry.name,
      path: this.joinPath(dirPath, entry.name),
      isDirectory: entry.isDirectory,
    }));

    return nodes.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
      }
      return a.isDirectory ? -1 : 1;
    });
  },

  async exists(path: string): Promise<boolean> {
    return FileSystemCommands.exists(path);
  },

  async mkdir(path: string, recursive: boolean): Promise<void> {
    await FileSystemCommands.mkdir(path, recursive);
  },

  async createFile(parentPath: string, name: string) {
    const validation = this.validateName(name);
    if (validation) throw new Error(validation);

    const targetPath = this.joinPath(parentPath, name.trim());
    if (await this.exists(targetPath)) throw new Error("目标已存在");

    await this.writeTextFile(targetPath, "");
    return targetPath;
  },

  async createFolder(parentPath: string, name: string) {
    const validation = this.validateName(name);
    if (validation) throw new Error(validation);

    const targetPath = this.joinPath(parentPath, name.trim());
    if (await this.exists(targetPath)) throw new Error("目标已存在");

    await this.mkdir(targetPath, false);
    return targetPath;
  },

  async renameEntry(oldPath: string, newName: string) {
    const validation = this.validateName(newName);
    if (validation) throw new Error(validation);

    const parentPath = this.dirname(oldPath);
    const newPath = this.joinPath(parentPath, newName.trim());
    if (oldPath === newPath) return newPath;
    if (await this.exists(newPath)) throw new Error("目标已存在");

    await FileSystemCommands.rename(oldPath, newPath);
    return newPath;
  },

  async deleteEntry(path: string, isDirectory: boolean) {
    await FileSystemCommands.remove(path, isDirectory);
  },

  async revealInOs(path: string) {
    await FileSystemCommands.revealInOs(path);
  },

  async copyOrMove(source: string, destination: string, isMove: boolean) {
    const workspaceRoot = WorkspaceService.getCurrent().primaryRoot;
    if (!workspaceRoot) throw new Error("Cannot copy or move files without an open workspace");
    await FileSystemCommands.copyOrMove(workspaceRoot, source, destination, isMove);
  },

  async startWatch(dirPath: string) {
    await this.stopWatch();
    try {
      if (!changedUnlistenPromise) {
        changedUnlistenPromise = FileSystemCommands.listenChanged((payload) => {
          if (activeWatchId && payload.id === activeWatchId) {
            EventBus.emit("fs:changed", {
              type: payload.kind,
              paths: payload.paths,
            });
          }
        });
      }
      activeWatchId = await FileSystemCommands.startWatch(dirPath, true);
    } catch (error) {
      console.warn("Failed to start file watcher:", error);
    }
  },

  async stopWatch() {
    if (activeWatchId) {
      await FileSystemCommands.stopWatch(activeWatchId).catch(() => undefined);
      activeWatchId = null;
    }
    changedUnlistenPromise?.then((unlisten) => unlisten()).catch(() => undefined);
    changedUnlistenPromise = null;
  },

  async readTextFile(path: string): Promise<string> {
    return FileSystemCommands.readTextFile(path);
  },

  async writeTextFile(path: string, content: string): Promise<void> {
    await FileSystemCommands.writeTextFile(path, content);
  },

  async writeTextFileAtomic(path: string, content: string) {
    const tmpPath = `${path}.aurona.tmp`;
    const bakPath = `${path}.aurona.bak`;
    try {
      await FileSystemCommands.writeTextFile(tmpPath, content);

      const fileExists = await this.exists(path);
      if (fileExists) {
        if (await this.exists(bakPath)) {
          await FileSystemCommands.remove(bakPath, false).catch(() => undefined);
        }
        await FileSystemCommands.rename(path, bakPath);
      }

      await FileSystemCommands.rename(tmpPath, path);

      if (fileExists) {
        await FileSystemCommands.remove(bakPath, false).catch(() => undefined);
      }
    } catch (error) {
      await FileSystemCommands.remove(tmpPath, false).catch(() => undefined);
      if (await this.exists(bakPath).catch(() => false)) {
        await FileSystemCommands.rename(bakPath, path).catch(() => undefined);
      }
      throw error;
    }
  },
};
