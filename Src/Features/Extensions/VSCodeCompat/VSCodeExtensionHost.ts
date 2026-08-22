/**
 * Aurona Code VS Code 扩展兼容宿主层 (VSCodeExtensionHost)
 * 为 VSIX 扩展与 Webview 插件提供标准 VS Code API 运行时环境
 */

import { EditorAdapter } from "../../../Core/Editor/EditorAdapter";
import { StatusBarRegistry } from "../../../Core/StatusBar/StatusBarRegistry";
import { WorkspaceService } from "../../../Core/WorkspaceService";
import { CommandRegistry } from "../../../Extension/CommandRegistry";
import { EventBus } from "../../../Foundation/EventBus";
import { LocaleService } from "../../../Foundation/I18n";
import { FileSystemCommands } from "../../../Foundation/IPC/FileSystemCommands";
import { UserConfigStore } from "../../../Foundation/Storage/UserConfigStore";
import type { UserConfig } from "../../../Foundation/Types/Config";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
  ) {}

  static file(filePath: string): Uri {
    const normalized = filePath.replace(/\\/g, "/");
    return new Uri("file", "", normalized, "", "");
  }

  static parse(uriString: string): Uri {
    try {
      const parsed = new URL(uriString);
      return new Uri(
        parsed.protocol.replace(":", ""),
        parsed.host,
        parsed.pathname,
        parsed.search,
        parsed.hash,
      );
    } catch {
      return Uri.file(uriString);
    }
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}

  isBefore(other: Position): boolean {
    if (this.line < other.line) return true;
    if (this.line > other.line) return false;
    return this.character < other.character;
  }

  isAfter(other: Position): boolean {
    if (this.line > other.line) return true;
    if (this.line < other.line) return false;
    return this.character > other.character;
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(
    startLineOrPos: number | Position,
    startCharOrEndPos: number | Position,
    endLine?: number,
    endChar?: number,
  ) {
    if (typeof startLineOrPos === "number" && typeof startCharOrEndPos === "number") {
      this.start = new Position(startLineOrPos, startCharOrEndPos);
      this.end = new Position(endLine ?? startLineOrPos, endChar ?? startCharOrEndPos);
    } else {
      this.start = startLineOrPos as Position;
      this.end = startCharOrEndPos as Position;
    }
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }
}

export class Selection extends Range {
  public readonly anchor: Position;
  public readonly active: Position;

  constructor(anchor: Position, active: Position) {
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }

  get isReversed(): boolean {
    return this.anchor.isAfter(this.active);
  }
}

export class Disposable {
  constructor(private readonly callOnDispose: () => void) {}

  dispose(): void {
    try {
      this.callOnDispose();
    } catch (error) {
      console.error("[Disposable] 释放失败:", error);
    }
  }

  static from(...disposables: { dispose(): void }[]): Disposable {
    return new Disposable(() => {
      for (const d of disposables) {
        d.dispose();
      }
    });
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export interface Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  code?: string | number;
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export interface VSCodeStatusBarItem {
  alignment: StatusBarAlignment;
  priority?: number;
  text: string;
  tooltip?: string;
  color?: string;
  command?: string;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface VSCodeWorkspaceFolder {
  readonly uri: Uri;
  readonly name: string;
  readonly index: number;
}

export interface TextEditorEdit {
  replace(range: Range, text: string): void;
  insert(position: Position, text: string): void;
  delete(range: Range): void;
}

export interface VSCodeExtensionAPI {
  version: string;
  Uri: typeof Uri;
  Position: typeof Position;
  Range: typeof Range;
  Selection: typeof Selection;
  Disposable: typeof Disposable;
  DiagnosticSeverity: typeof DiagnosticSeverity;
  StatusBarAlignment: typeof StatusBarAlignment;

  window: {
    showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
    showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
    showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
    setStatusBarMessage(text: string, hideAfterTimeout?: number): Disposable;
    createStatusBarItem(
      alignmentOrPriority?: StatusBarAlignment | number,
      priority?: number,
    ): VSCodeStatusBarItem;
    activeTextEditor:
      | {
          document: {
            uri: Uri;
            fileName: string;
            languageId: string;
            getText(range?: Range): string;
          };
          selection: Selection;
          edit(callback: (editBuilder: TextEditorEdit) => void): Promise<boolean>;
        }
      | undefined;
  };

  commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
    executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
    getCommands(): Promise<string[]>;
  };

  workspace: {
    name: string | undefined;
    workspaceFolders: readonly VSCodeWorkspaceFolder[] | undefined;
    getConfiguration(section?: string): {
      get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined>;
      update(key: string, value: unknown): Promise<void>;
    };
    fs: {
      readFile(uri: Uri): Promise<Uint8Array>;
      writeFile(uri: Uri, content: Uint8Array): Promise<void>;
      stat(uri: Uri): Promise<{ type: number; size: number; mtime: number }>;
    };
  };

  env: {
    appName: string;
    appRoot: string;
    language: string;
    clipboard: {
      readText(): Promise<string>;
      writeText(value: string): Promise<void>;
    };
    openExternal(target: Uri | string): Promise<boolean>;
  };
}

/**
 * 为指定扩展创建沙箱隔离的 VS Code 兼容 API 实例
 */
export function createVSCodeExtensionHost(extensionId: string): VSCodeExtensionAPI {
  return {
    version: "1.90.0",
    Uri,
    Position,
    Range,
    Selection,
    Disposable,
    DiagnosticSeverity,
    StatusBarAlignment,

    window: {
      async showInformationMessage(message: string, ...items: string[]) {
        EventBus.emit("app:toast", {
          type: "info",
          title: `[${extensionId}]`,
          message,
        });
        return items[0];
      },

      async showWarningMessage(message: string, ...items: string[]) {
        EventBus.emit("app:toast", {
          type: "warning",
          title: `[${extensionId}]`,
          message,
        });
        return items[0];
      },

      async showErrorMessage(message: string, ...items: string[]) {
        EventBus.emit("app:toast", {
          type: "error",
          title: `[${extensionId}]`,
          message,
        });
        return items[0];
      },

      setStatusBarMessage(text: string, hideAfterTimeout?: number) {
        const item = StatusBarRegistry.createItem({
          id: `vscode.temp.${extensionId}.${Date.now()}`,
          alignment: "left",
          priority: 50,
          text,
        });

        if (hideAfterTimeout && hideAfterTimeout > 0) {
          setTimeout(() => item.dispose(), hideAfterTimeout);
        }

        return new Disposable(() => item.dispose());
      },

      createStatusBarItem(alignmentOrPriority = StatusBarAlignment.Right, priority = 0) {
        const alignment = alignmentOrPriority === StatusBarAlignment.Left ? "left" : "right";
        const actualPriority =
          typeof alignmentOrPriority === "number" &&
          alignmentOrPriority !== StatusBarAlignment.Left &&
          alignmentOrPriority !== StatusBarAlignment.Right
            ? alignmentOrPriority
            : priority;

        const handle = StatusBarRegistry.createItem({
          id: `vscode.ext.${extensionId}.${Math.random().toString(36).slice(2, 8)}`,
          alignment,
          priority: actualPriority,
          text: "",
          visible: false,
        });

        return {
          alignment: alignmentOrPriority as StatusBarAlignment,
          priority: actualPriority,
          get text() {
            return handle.text;
          },
          set text(val: string) {
            handle.text = val;
          },
          get tooltip() {
            return handle.tooltip;
          },
          set tooltip(val: string | undefined) {
            handle.tooltip = val;
          },
          get command() {
            return handle.command;
          },
          set command(val: string | undefined) {
            handle.command = val;
          },
          show() {
            handle.show();
          },
          hide() {
            handle.hide();
          },
          dispose() {
            handle.dispose();
          },
        };
      },

      get activeTextEditor() {
        const state = useWorkbenchStore.getState();
        const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
        if (activeTab?.type !== "file" || !activeTab.path) {
          return undefined;
        }

        const editorStatus = EditorAdapter.getStatus();
        return {
          document: {
            uri: Uri.file(activeTab.path),
            fileName: activeTab.path,
            languageId: activeTab.path.split(".").pop() || "plaintext",
            getText(range?: Range) {
              const fullText = EditorAdapter.getText();
              if (!range) return fullText;
              const lines = fullText.split("\n");
              return lines.slice(range.start.line, range.end.line + 1).join("\n");
            },
          },
          selection: new Selection(
            new Position(editorStatus.line, editorStatus.column),
            new Position(editorStatus.line, editorStatus.column),
          ),
          async edit(callback: (editBuilder: TextEditorEdit) => void) {
            try {
              const editBuilder: TextEditorEdit = {
                replace(range: Range, text: string) {
                  EditorAdapter.replaceRange(range.start.line, range.end.line, text);
                },
                insert(_pos: Position, text: string) {
                  EditorAdapter.insertCode(text);
                },
                delete(range: Range) {
                  EditorAdapter.replaceRange(range.start.line, range.end.line, "");
                },
              };
              callback(editBuilder);
              return true;
            } catch {
              return false;
            }
          },
        };
      },
    },

    commands: {
      registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
        CommandRegistry.register({
          id: command,
          title: command,
          category: extensionId,
          handler: (args) => {
            callback(args);
          },
        });

        return new Disposable(() => {
          CommandRegistry.unregister(command);
        });
      },

      async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
        const res = await CommandRegistry.execute(command, ...args);
        return res.ok;
      },

      async getCommands(): Promise<string[]> {
        return CommandRegistry.getCommands().map((cmd) => cmd.id);
      },
    },

    workspace: {
      get name() {
        return WorkspaceService.getCurrent().primaryRoot?.split(/[\\/]/).pop();
      },

      get workspaceFolders() {
        const path = WorkspaceService.getCurrent().primaryRoot;
        if (!path) return undefined;
        return [
          {
            uri: Uri.file(path),
            name: path.split(/[\\/]/).pop() || "workspace",
            index: 0,
          },
        ];
      },

      getConfiguration(section?: string) {
        return {
          async get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
            const config = (await UserConfigStore.get()) as Record<string, unknown>;
            const fullKey = section ? `${section}.${key}` : key;
            const val = config[fullKey] ?? config[key];
            return (val !== undefined ? val : defaultValue) as T;
          },
          async update(key: string, value: unknown): Promise<void> {
            await UserConfigStore.set({ [key]: value } as Partial<UserConfig>);
          },
        };
      },

      fs: {
        async readFile(uri: Uri): Promise<Uint8Array> {
          const content = await FileSystemCommands.readTextFile(uri.fsPath);
          return new TextEncoder().encode(content);
        },

        async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
          const text = new TextDecoder().decode(content);
          await FileSystemCommands.writeTextFile(uri.fsPath, text);
        },

        async stat(uri: Uri) {
          const exists = await FileSystemCommands.exists(uri.fsPath);
          return {
            type: exists ? 1 : 0,
            size: 0,
            mtime: Date.now(),
          };
        },
      },
    },

    env: {
      appName: "Aurona Code",
      appRoot: "",
      get language() {
        return LocaleService.get();
      },
      clipboard: {
        async readText(): Promise<string> {
          if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
            return navigator.clipboard.readText();
          }
          return "";
        },
        async writeText(value: string): Promise<void> {
          if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
          }
        },
      },
      async openExternal(target: Uri | string): Promise<boolean> {
        const urlStr = typeof target === "string" ? target : target.toString();
        window.open(urlStr, "_blank");
        return true;
      },
    },
  };
}
