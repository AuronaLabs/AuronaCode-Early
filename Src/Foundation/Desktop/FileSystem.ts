import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export { BaseDirectory };

export const desktopFileSystem = {
  exists,
  mkdir,
  readTextFile,
  remove,
  rename,
  writeTextFile,

  /**
   * 原子写文本文件：tmp → (原文件让位到 bak) → rename → 清理 bak。
   * 写一半崩溃时旧文件保留在 bak，不会出现半截 JSON。与
   * Core/FileSystemService.writeTextFileAtomic 同一协议，但基于
   * BaseDirectory（plugin-fs），供 AppLocalData 下的配置文件使用。
   */
  async writeTextFileAtomic(
    path: string,
    content: string,
    options: { baseDir: BaseDirectory },
  ): Promise<void> {
    const tmpPath = `${path}.aurona.tmp`;
    const bakPath = `${path}.aurona.bak`;
    try {
      await writeTextFile(tmpPath, content, options);
      const hadOriginal = await exists(path, options);
      if (hadOriginal) {
        if (await exists(bakPath, options)) {
          await remove(bakPath, options).catch(() => undefined);
        }
        await rename(path, bakPath, {
          oldPathBaseDir: options.baseDir,
          newPathBaseDir: options.baseDir,
        });
      }
      await rename(tmpPath, path, {
        oldPathBaseDir: options.baseDir,
        newPathBaseDir: options.baseDir,
      });
      if (hadOriginal) {
        await remove(bakPath, options).catch(() => undefined);
      }
    } catch (error) {
      // 失败回滚：清理 tmp，原文件仍在（或从 bak 还原）
      await remove(tmpPath, options).catch(() => undefined);
      try {
        if ((await exists(bakPath, options).catch(() => false)) && !(await exists(path, options))) {
          await rename(bakPath, path, {
            oldPathBaseDir: options.baseDir,
            newPathBaseDir: options.baseDir,
          }).catch(() => undefined);
        }
      } catch {
        // 还原失败保持静默（保留 tmp/bak 供人工排查）
      }
      throw error;
    }
  },
};
