export const BINARY_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "webp",
  "svg",
  "mp4",
  "webm",
  "mp3",
  "wav",
  "ogg",

  "ttf",
  "otf",
  "woff",
  "woff2",

  "zip",
  "tar",
  "gz",
  "7z",
  "rar",

  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "class",
  "jar",
  "pyc",

  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
];

export function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.includes(ext.toLowerCase());
}
