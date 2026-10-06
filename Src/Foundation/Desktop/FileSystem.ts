import { BaseDirectory } from "@tauri-apps/api/path";
import { invokeDesktop } from "./Transport";

export { BaseDirectory };

interface StorageOptions {
  baseDir?: BaseDirectory;
  recursive?: boolean;
  append?: boolean;
}

function area(options?: StorageOptions): string {
  if (options?.baseDir === BaseDirectory.AppLocalData) return "data";
  if (options?.baseDir === BaseDirectory.AppLog) return "log";
  throw new Error("Storage operations require an application storage area");
}

export const desktopFileSystem = {
  exists: (path: string, options?: StorageOptions) =>
    invokeDesktop<boolean>("app_storage_exists", { path, area: area(options) }),
  mkdir: (path: string, options?: StorageOptions) =>
    invokeDesktop<void>("app_storage_mkdir", { path, area: area(options) }),
  readTextFile: (path: string, options?: StorageOptions) =>
    invokeDesktop<string>("app_storage_read", { path, area: area(options) }),
  remove: (path: string, options?: StorageOptions) =>
    invokeDesktop<void>("app_storage_remove", { path, area: area(options) }),
  writeTextFile: (path: string, content: string, options?: StorageOptions) =>
    invokeDesktop<void>("app_storage_write", {
      path,
      content,
      area: area(options),
      append: options?.append ?? false,
    }),
  writeTextFileAtomic: (path: string, content: string, options: StorageOptions) =>
    invokeDesktop<void>("app_storage_write", { path, content, area: area(options), append: false }),
};
