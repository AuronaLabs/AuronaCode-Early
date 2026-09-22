import { describe, expect, it } from "vitest";
import { DiagnosticsService } from "../../../Core/DiagnosticsService";
import { pathToFileUri } from "../../../Shared/Utils/UriUtils";
import {
  activateVSCodeExtension,
  createVSCodeExtensionHost,
  DiagnosticSeverity,
  Disposable,
  deactivateVSCodeExtension,
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

  it("publishes diagnostic collection entries without clobbering foreign sources", () => {
    DiagnosticsService.clear();
    const vscode = createVSCodeExtensionHost("test.ext");
    const fileUri = Uri.file("C:/repo/index.ts");
    const key = pathToFileUri("C:/repo/index.ts");

    // 外部来源（如 LSP）先行写入同一文档
    DiagnosticsService.update({
      uri: key,
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "from-lsp",
          severity: 1,
        },
      ],
    });

    const collection = vscode.languages.createDiagnosticCollection("demo");
    collection.set(fileUri, [
      {
        range: new Range(new Position(2, 0), new Position(2, 4)),
        message: "demo-error",
        severity: DiagnosticSeverity.Error,
      },
    ]);
    expect(DiagnosticsService.get(key)?.diagnostics).toHaveLength(2);

    // 集合重设：旧集合条目移除，外部来源保留
    collection.set(fileUri, [
      {
        range: new Range(new Position(3, 1), new Position(3, 2)),
        message: "demo-warning",
        severity: DiagnosticSeverity.Warning,
      },
    ]);
    expect(DiagnosticsService.get(key)?.diagnostics.map((item) => item.message)).toEqual([
      "from-lsp",
      "demo-warning",
    ]);

    collection.delete(fileUri);
    expect(DiagnosticsService.get(key)?.diagnostics.map((item) => item.message)).toEqual([
      "from-lsp",
    ]);
    collection.dispose();
    DiagnosticsService.clear();
  });

  it("collects returned disposables into context subscriptions and disposes on deactivate", async () => {
    const order: string[] = [];
    const context = await activateVSCodeExtension("test.ext", (ctx) => {
      expect(ctx.extensionUri.scheme).toBe("file");
      ctx.subscriptions.push(new Disposable(() => order.push("pushed")));
      return new Disposable(() => order.push("returned"));
    });
    expect(context.subscriptions).toHaveLength(2);

    deactivateVSCodeExtension(context);
    expect(order).toEqual(["returned", "pushed"]);
    expect(context.subscriptions).toHaveLength(0);

    const arrayContext = await activateVSCodeExtension("test.ext", () => [
      new Disposable(() => {}),
      { dispose: () => {} },
      "not-a-disposable",
    ]);
    expect(arrayContext.subscriptions).toHaveLength(2);
  });
});
