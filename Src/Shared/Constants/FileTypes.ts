// 定义会被认为是二进制或无需加载为文本编辑器的常见扩展名
export const BINARY_EXTENSIONS = [
  // 媒体文件
  "png", "jpg", "jpeg", "gif", "ico", "webp", "svg", "mp4", "webm", "mp3", "wav", "ogg",
  // 字体
  "ttf", "otf", "woff", "woff2",
  // 压缩包与打包格式
  "zip", "tar", "gz", "7z", "rar",
  // 编译产物/可执行文件
  "exe", "dll", "so", "dylib", "bin", "class", "jar", "pyc",
  // 其他常见的非文本格式
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"
];

/**
 * 判断指定扩展名是否为典型的二进制文件
 */
export function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.includes(ext.toLowerCase());
}
