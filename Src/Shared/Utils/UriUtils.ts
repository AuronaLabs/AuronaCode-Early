export function uriToPath(uri: string): string {
  const url = new URL(uri);
  let path = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  if (url.host) path = `//${url.host}${path}`;
  return path.replace(/\//g, "\\");
}

export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file:")) return null;
  try {
    return uriToPath(uri);
  } catch {
    return null;
  }
}

export function pathToFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const withDrive = /^[A-Za-z]:/.test(normalized) ? `/${normalized}` : normalized;
  return `file://${withDrive.split("/").map(encodeURIComponent).join("/")}`;
}
