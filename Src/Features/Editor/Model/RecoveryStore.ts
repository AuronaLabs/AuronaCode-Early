import { BaseDirectory, desktopFileSystem } from "../../../Foundation/Desktop";
import { Logger } from "../../../Foundation/Logger";

const DIRECTORY = "editor-recovery";
const MAX_RECOVERY_BYTES = 8 * 1024 * 1024;

export interface RecoverySnapshot {
  schema: 1;
  path: string;
  text: string;
  diskFingerprint: string;
  createdAt: number;
}

function keyForPath(path: string) {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index++) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}.json`;
}

function recoveryPath(path: string) {
  return `${DIRECTORY}/${keyForPath(path)}`;
}

export const RecoveryStore = {
  async load(path: string): Promise<RecoverySnapshot | null> {
    try {
      const target = recoveryPath(path);
      if (!(await desktopFileSystem.exists(target, { baseDir: BaseDirectory.AppLocalData }))) {
        return null;
      }
      const value = JSON.parse(
        await desktopFileSystem.readTextFile(target, { baseDir: BaseDirectory.AppLocalData }),
      ) as RecoverySnapshot;
      return value.schema === 1 && value.path === path ? value : null;
    } catch (error) {
      Logger.warn("Unable to load editor recovery snapshot", error);
      return null;
    }
  },

  async save(path: string, text: string, diskFingerprint: string): Promise<void> {
    if (text.length * 2 > MAX_RECOVERY_BYTES) {
      Logger.warn("Editor recovery snapshot skipped because it exceeds the local size budget", {
        path,
      });
      return;
    }
    try {
      await desktopFileSystem.mkdir(DIRECTORY, {
        baseDir: BaseDirectory.AppLocalData,
        recursive: true,
      });
      const snapshot: RecoverySnapshot = {
        schema: 1,
        path,
        text,
        diskFingerprint,
        createdAt: Date.now(),
      };
      await desktopFileSystem.writeTextFile(recoveryPath(path), JSON.stringify(snapshot), {
        baseDir: BaseDirectory.AppLocalData,
      });
    } catch (error) {
      Logger.warn("Unable to persist editor recovery snapshot", error);
    }
  },

  async remove(path: string): Promise<void> {
    try {
      const target = recoveryPath(path);
      if (await desktopFileSystem.exists(target, { baseDir: BaseDirectory.AppLocalData })) {
        await desktopFileSystem.remove(target, { baseDir: BaseDirectory.AppLocalData });
      }
    } catch (error) {
      Logger.warn("Unable to remove editor recovery snapshot", error);
    }
  },
};
