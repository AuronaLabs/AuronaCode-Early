import { describe, expect, it } from "vitest";
import {
  createVSCodeExtensionHost,
  Position,
  Range,
  resolveConfigKey,
  Selection,
  Uri,
} from "./VSCodeExtensionHost";

describe("resolveConfigKey", () => {
  it("maps VS Code section + key onto Aurona flat camelCase keys", () => {
    // editor + fontSize -> editorFontSize（Aurona 的扁平键）
    expect(resolveConfigKey("editor", "fontSize")).toEqual([
      "editor.fontSize",
      "fontSize",
      "editorFontSize",
    ]);
  });

  it("keeps the bare key first-class when no section is given", () => {
    expect(resolveConfigKey(undefined, "editorFontSize")).toEqual(["editorFontSize"]);
  });

  it("tolerates an empty key without producing a broken candidate", () => {
    expect(resolveConfigKey("editor", "")).toEqual(["editor.", ""]);
  });
});

describe("VSCodeExtensionHost", () => {
  it("implements standard VS Code Uri parsing and operations", () => {
    const fileUri = Uri.file("e:/project/index.ts");
    expect(fileUri.scheme).toBe("file");
    expect(fileUri.fsPath).toBe("e:/project/index.ts");

    const webUri = Uri.parse("https://aurona.cc/docs");
    expect(webUri.scheme).toBe("https");
    expect(webUri.authority).toBe("aurona.cc");
  });

  it("implements Position and Range comparisons", () => {
    const pos1 = new Position(10, 5);
    const pos2 = new Position(10, 8);
    const pos3 = new Position(12, 0);

    expect(pos1.isBefore(pos2)).toBe(true);
    expect(pos3.isAfter(pos2)).toBe(true);
    expect(pos1.isEqual(new Position(10, 5))).toBe(true);

    const range = new Range(pos1, pos2);
    expect(range.isEmpty).toBe(false);

    const emptyRange = new Range(pos1, pos1);
    expect(emptyRange.isEmpty).toBe(true);

    const selection = new Selection(pos2, pos1);
    expect(selection.isReversed).toBe(true);
  });

  it("creates sandboxed extension API instance with commands and status bar support", async () => {
    const vscode = createVSCodeExtensionHost("test.ext");
    expect(vscode.version).toBe("1.90.0");
    expect(typeof vscode.window.showInformationMessage).toBe("function");

    // 状态栏
    const item = vscode.window.createStatusBarItem(1, 99);
    item.text = "Hello VSCode";
    item.show();
    expect(item.text).toBe("Hello VSCode");
    item.dispose();

    // 命令注册
    let executed = false;
    const disposable = vscode.commands.registerCommand("test.ext.hello", () => {
      executed = true;
    });

    const commands = await vscode.commands.getCommands();
    expect(commands).toContain("test.ext.hello");

    await vscode.commands.executeCommand("test.ext.hello");
    expect(executed).toBe(true);

    disposable.dispose();
  });
});
