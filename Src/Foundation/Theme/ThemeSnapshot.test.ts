import { afterEach, describe, expect, it } from "vitest";
import { buildCompatWebviewDocument } from "../Security/CompatWebviewDocument";
import { readThemeSnapshot } from "./ThemeSnapshot";

afterEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});
describe("shared theme snapshot", () => {
  it("resolves system theme from the effective workbench class and reads semantic tokens", () => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.setProperty("--color-text-primary", "#ccddee");
    const snapshot = readThemeSnapshot({ theme: "system" });
    expect(snapshot.mode).toBe("dark");
    expect(snapshot.text).toBe("#ccddee");
    expect(
      buildCompatWebviewDocument("<p>preview</p>", false, "channel", snapshot, null),
    ).toContain("--vscode-editor-foreground:#ccddee");
  });
  it("rejects injected CSS and keeps webview content transparent", () => {
    const snapshot = readThemeSnapshot({ theme: "light", accentColor: "red;}body{display:none" });
    expect(snapshot.accent).toBe("#2563eb");
    const html = buildCompatWebviewDocument("<p>preview</p>", false, "channel", snapshot, null);
    expect(html).toContain("background:transparent!important");
    expect(html).not.toContain("display:none");
  });
});
