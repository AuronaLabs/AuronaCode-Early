/** Resolves a path lexically. The host still verifies authorization and symlinks. */
export function resolveWorkspacePath(root: string, input: string, windows: boolean): string {
  if (input.includes("\0") || /^[a-z]:(?![\\/])/i.test(input)) {
    throw new Error("Invalid workspace path");
  }
  const normalize = (value: string) => {
    const slash = value.replaceAll("\\", "/");
    const prefix = slash.startsWith("//") ? "//" : slash.startsWith("/") ? "/" : "";
    const parts: string[] = [];
    for (const part of slash.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length || /^[a-z]:$/i.test(parts.at(-1) ?? "")) {
          throw new Error("Path must stay inside the workspace");
        }
        parts.pop();
      } else parts.push(part);
    }
    return prefix + parts.join("/");
  };
  const base = normalize(root);
  const raw = input.replaceAll("\\", "/");
  const resolved = normalize(
    /^(?:[a-z]:\/|\/)/i.test(raw) ? raw : `${base}${base.endsWith("/") ? "" : "/"}${raw}`,
  );
  const identity = (value: string) => (windows ? value.toLowerCase() : value);
  const baseId = identity(base);
  const resultId = identity(resolved);
  if (resultId !== baseId && !resultId.startsWith(baseId.endsWith("/") ? baseId : `${baseId}/`)) {
    throw new Error("Path must stay inside the workspace");
  }
  return /^[a-z]:$/i.test(resolved) ? `${resolved}/` : resolved;
}
