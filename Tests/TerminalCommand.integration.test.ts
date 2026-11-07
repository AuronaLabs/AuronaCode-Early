// @vitest-environment node
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { wrapTerminalCommand } from "../Src/Core/TerminalCommand";

const marker = "__AURONA_CMD_INTEGRATION__";
const posixShell = process.platform === "win32" ? process.env.AURONA_TEST_POSIX_SHELL : "/bin/sh";

function execute(shell: string, command: string, prefix = "") {
  const wrapped = wrapTerminalCommand(shell, command, marker);
  const powershell = shell === "powershell";
  const cmd = shell === "cmd";
  const result = spawnSync(
    powershell ? "powershell.exe" : cmd ? "cmd.exe" : (posixShell ?? "/bin/sh"),
    powershell
      ? ["-NoProfile", "-NonInteractive", "-Command", `${prefix}${wrapped}`]
      : cmd
        ? ["/d", "/q"]
        : ["-c", wrapped],
    {
      input: cmd ? `${wrapped}\r\nexit\r\n` : undefined,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stdout, result.stderr).toMatch(
    new RegExp(`(?:^|\\r?\\n)${marker}:(-?\\d+)\\r?\\n`),
  );
  return result.stdout.match(new RegExp(`(?:^|\\r?\\n)${marker}:(-?\\d+)\\r?\\n`))?.[1];
}

describe.skipIf(process.platform !== "win32")("Windows shell command markers", () => {
  it("does not inherit a previous PowerShell native exit code", () => {
    expect(execute("powershell", "Write-Output 'done'", "$global:LASTEXITCODE = 9; ")).toBe("0");
  }, 20_000);
  it("returns a failing native command exit code", () => {
    expect(execute("powershell", "cmd.exe /c exit 7")).toBe("7");
  }, 20_000);
  it("returns failure for a PowerShell command error", () => {
    expect(execute("powershell", "Write-Error 'expected test error'")).toBe("1");
  }, 20_000);
  it("emits a marker after a terminating PowerShell error", () => {
    expect(execute("powershell", "throw 'expected test error'")).toBe("1");
  }, 20_000);
  it("starts a new marker line after output without a newline", () => {
    expect(execute("powershell", "Write-Host -NoNewline 'done'")).toBe("0");
  }, 20_000);
  it("uses the Command Prompt exit code", () => {
    expect(execute("cmd", "cmd.exe /c exit 7")).toBe("7");
  }, 20_000);
});

describe.skipIf(!posixShell)("POSIX shell command markers", () => {
  it("runs a multiline command and preserves the last exit status", () => {
    expect(execute("sh", "printf 'done'\nfalse")).toBe("1");
  });
  it("preserves success when the last line is a comment", () => {
    expect(execute("sh", "printf 'done'\n# final comment")).toBe("0");
  });
});
