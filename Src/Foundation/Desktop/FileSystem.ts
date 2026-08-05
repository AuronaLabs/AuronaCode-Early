import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export { BaseDirectory };

export const desktopFileSystem = {
  exists,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
};
