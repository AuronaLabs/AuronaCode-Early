import { TerminalManager } from "../../Core/TerminalService";

export const RUNNABLE_EXTENSIONS = ["js", "ts", "py", "rs", "go"];

export function isRunnable(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return RUNNABLE_EXTENSIONS.includes(ext);
}

export function handleSmartRun(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  let cmd = "";
  // Since we might be on Windows, wrap path in quotes
  const safePath = `"${path}"`;

  switch (ext) {
    case "js":
      cmd = `node ${safePath}`;
      break;
    case "ts":
      cmd = `ts-node ${safePath}`;
      break;
    case "py":
      cmd = `python ${safePath}`;
      break;
    case "go":
      cmd = `go run ${safePath}`;
      break;
    case "rs":
      cmd = `rustc ${safePath} -o "temp.exe" ; if ($?) { .\\temp.exe }`;
      break;
  }

  if (cmd) {
    TerminalManager.executeCommand(null, cmd);
  }
}
