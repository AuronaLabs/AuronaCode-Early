export function GetLanguageFromPath(path: string | null): string {
  if (!path) return "plaintext";

  const lowerPath = path.toLowerCase();
  const ext = lowerPath.includes(".") ? lowerPath.slice(lowerPath.lastIndexOf(".") + 1) : "";
  const filename = lowerPath.split(/[/\\]/).pop() || "";

  if (["ts", "tsx", "mts", "cts"].includes(ext)) return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "javascript";
  if (["json", "jsonc", "eslintrc", "prettierrc"].includes(ext) || filename.endsWith("rc"))
    return "json";
  if (["css", "scss", "sass", "less"].includes(ext)) return ext === "css" ? "css" : "scss";
  if (["html", "htm", "xhtml"].includes(ext)) return "html";
  if (["md", "mdx", "markdown"].includes(ext)) return "markdown";
  if (["rs"].includes(ext)) return "rust";
  if (["py", "pyw"].includes(ext)) return "python";
  if (["java"].includes(ext)) return "java";
  if (["c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"].includes(ext)) return "cpp";
  if (["go"].includes(ext)) return "go";
  if (["sh", "bash", "zsh", "fish", "ps1"].includes(ext))
    return ext === "ps1" ? "powershell" : "shell";
  if (["xml", "svg"].includes(ext)) return "xml";
  if (["yaml", "yml"].includes(ext)) return "yaml";
  if (["toml"].includes(ext)) return "toml";
  if (["sql"].includes(ext)) return "sql";
  if (["php"].includes(ext)) return "php";
  if (["rb"].includes(ext)) return "ruby";
  if (["swift"].includes(ext)) return "swift";
  if (["kt", "kts"].includes(ext)) return "kotlin";
  if (["dockerfile"].includes(filename) || filename === "dockerfile") return "dockerfile";

  return "plaintext";
}
