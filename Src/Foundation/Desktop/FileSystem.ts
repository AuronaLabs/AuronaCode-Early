import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  watch,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export { BaseDirectory };

export const desktopFileSystem = {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  watch,
  writeTextFile,
};
