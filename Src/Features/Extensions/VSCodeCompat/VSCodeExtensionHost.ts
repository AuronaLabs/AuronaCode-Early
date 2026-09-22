/**
 * Aurona Code VS Code 扩展兼容宿主层 (VSCodeExtensionHost)
 * 为 VSIX 扩展与 Webview 插件提供标准 VS Code API 运行时环境
 */

import { DocumentService, type DocumentRecord } from "../../../Core/DocumentService";
import {
  DiagnosticsService,
  type DiagnosticItem,
} from "../../../Core/DiagnosticsService";
import { EditorAdapter } from "../../../Core/Editor/EditorAdapter";
import { StatusBarRegistry } from "../../../Core/StatusBar/StatusBarRegistry";
import { WorkspaceService } from "../../../Core/WorkspaceService";
import { CommandRegistry } from "../../../Extension/CommandRegistry";
import { EventBus } from "../../../Foundation/EventBus";
import { LocaleService } from "../../../Foundation/I18n";
import { FileSystemCommands } from "../../../Foundation/IPC/FileSystemCommands";
import { UserConfigStore } from "../../../Foundation/Storage/UserConfigStore";
import type { UserConfig } from "../../../Foundation/Types/Config";
import type { TabItem } from "../../../Foundation/Types/Tab";
import { GetLanguageFromPath } from "../../../Shared/Utils/LanguageUtils";
import { pathToFileUri } from "../../../Shared/Utils/UriUtils";
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

/** 诊断集合：写入底层 DiagnosticsService，按集合跟踪自有条目，避免清掉 LSP 等其他来源 */
export interface DiagnosticCollection {
  readonly name: string;
  set(uri: Uri, diagnostics: readonly Diagnostic[]): void;
  delete(uri: Uri): void;
  clear(): void;
  dispose(): void;
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

/** VS Code TextDocument 的兼容快照（简化版：全文 getText） */
export interface VSCodeTextDocument {
  readonly uri: Uri;
  readonly fileName: string;
  readonly languageId: string;
  readonly version: number;
  readonly isDirty: boolean;
  getText(): string;
}

export interface TextDocumentContentChange {
  readonly text: string;
}

/** 文档变更事件（contentChanges 简化为全文替换） */
export interface TextDocumentChangeEvent {
  readonly document: VSCodeTextDocument;
  readonly contentChanges: readonly TextDocumentContentChange[];
}

/** VS Code 扩展激活上下文 */
export interface VSCodeExtensionContext {
  /** 扩展安装目录（前端侧暂无安装路径数据源，先以扩展 id 占位） */
  readonly extensionPath: string;
  readonly extensionUri: Uri;
  /** 激活期间注册的 Disposable；禁用/停用时逆序 dispose */
  readonly subscriptions: Disposable[];
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
  FileType: typeof FileType;
  StatusBarAlignment: typeof StatusBarAlignment;

  languages: {
    createDiagnosticCollection(name: string): DiagnosticCollection;
    DiagnosticSeverity: typeof DiagnosticSeverity;
  };

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
    onDidOpenTextDocument(listener: (document: VSCodeTextDocument) => void): Disposable;
    onDidChangeTextDocument(listener: (event: TextDocumentChangeEvent) => void): Disposable;
    onDidCloseTextDocument(listener: (document: VSCodeTextDocument) => void): Disposable;
    getConfiguration(section?: string): {
      get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined>;
      update(key: string, value: unknown): Promise<void>;
    };
    fs: {
      readFile(uri: Uri): Promise<Uint8Array>;
      writeFile(uri: Uri, content: Uint8Array): Promise<void>;
      stat(uri: Uri): Promise<{ type: FileType; size: number; mtime: number }>;
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
 * 把 VS Code 风格的配置查询映射到 Aurona 的扁平配置结构。
 *
 * Aurona 的 user-config.json 是扁平 camelCase（如 `editorFontSize`），
 * 而 VS Code 扩展习惯写 `getConfiguration("editor").get("fontSize")`。
 * 解析顺序（前者优先）：
 *   1. 点号拼接键 `section.key` —— 若配置将来改为嵌套结构可直接命中
 *   2. 扁平键 `key` —— 无 section 时的常规命中
 *   3. `section` + 首字母大写的 `key` —— `editor` + `fontSize` → `editorFontSize`
 */
export function resolveConfigKey(section: string | undefined, key: string): string[] {
  const candidates: string[] = [];
  if (section) candidates.push(`${section}.${key}`);
  candidates.push(key);
  if (section && key.length > 0) {
    candidates.push(`${section}${key.charAt(0).toUpperCase()}${key.slice(1)}`);
  }
  return candidates;
}

/** 诊断文档 uri 统一走 pathToFileUri 规范化（与 LSP、问题面板的 key 约定一致） */
function canonicalDiagnosticUri(uri: Uri): string {
  return uri.scheme === "file" ? pathToFileUri(uri.fsPath) : uri.toString();
}

class DiagnosticCollectionImpl implements DiagnosticCollection {
  /** 本集合已发布到各 uri 的条目（按引用跟踪，便于替换时保留其他来源诊断） */
  private readonly published = new Map<string, DiagnosticItem[]>();
  private disposed = false;

  constructor(readonly name: string) {}

  set(uri: Uri, diagnostics: readonly Diagnostic[]): void {
    if (this.disposed) return;
    this.replaceOwned(
      canonicalDiagnosticUri(uri),
      diagnostics.map((diagnostic) => this.toServiceDiagnostic(diagnostic)),
    );
  }

  delete(uri: Uri): void {
    if (this.disposed) return;
    this.replaceOwned(canonicalDiagnosticUri(uri), []);
  }

  clear(): void {
    if (this.disposed) return;
    for (const key of [...this.published.keys()]) {
      this.replaceOwned(key, []);
    }
  }

  dispose(): void {
    this.clear();
    this.published.clear();
    this.disposed = true;
  }

  private toServiceDiagnostic(diagnostic: Diagnostic): DiagnosticItem {
    return {
      range: {
        start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
        end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character },
      },
      message: diagnostic.message,
      severity: diagnostic.severity,
      source: diagnostic.source ?? this.name,
      code: diagnostic.code,
    };
  }

  /** 用本集合的新条目替换旧条目，同一文档上 LSP 等其他来源的诊断保持不动 */
  private replaceOwned(key: string, owned: DiagnosticItem[]): void {
    const previous = this.published.get(key);
    const existing = DiagnosticsService.get(key)?.diagnostics ?? [];
    const foreign = previous ? existing.filter((item) => !previous.includes(item)) : [...existing];
    this.published.set(key, owned);
    DiagnosticsService.update({ uri: key, diagnostics: [...foreign, ...owned] });
  }
}

type PathWatcher = {
  unlisten: () => void;
  seen: boolean;
  lastVersion: number;
  lastDirty: boolean;
  lastContent: string;
  lastDocument: VSCodeTextDocument | null;
};

/**
 * 文档事件中继：把 DocumentService 的按 path 订阅 + 工作区标签变化，
 * 转译为 VS Code 风格的 onDidOpen/onDidChange/onDidClose 文档事件。
 * 无监听者时不挂任何订阅，监听者全部注销后自动释放。
 */
class DocumentEventRelay {
  private readonly openListeners = new Set<(document: VSCodeTextDocument) => void>();
  private readonly changeListeners = new Set<(event: TextDocumentChangeEvent) => void>();
  private readonly closeListeners = new Set<(document: VSCodeTextDocument) => void>();
  private readonly watchers = new Map<string, PathWatcher>();
  private storeUnlisten: (() => void) | null = null;

  onDidOpenTextDocument(listener: (document: VSCodeTextDocument) => void): () => void {
    this.openListeners.add(listener);
    this.syncLifecycle();
    return () => {
      this.openListeners.delete(listener);
      this.syncLifecycle();
    };
  }

  onDidChangeTextDocument(listener: (event: TextDocumentChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    this.syncLifecycle();
    return () => {
      this.changeListeners.delete(listener);
      this.syncLifecycle();
    };
  }

  onDidCloseTextDocument(listener: (document: VSCodeTextDocument) => void): () => void {
    this.closeListeners.add(listener);
    this.syncLifecycle();
    return () => {
      this.closeListeners.delete(listener);
      this.syncLifecycle();
    };
  }

  private get listenerCount(): number {
    return this.openListeners.size + this.changeListeners.size + this.closeListeners.size;
  }

  private syncLifecycle(): void {
    if (this.listenerCount > 0) {
      if (!this.storeUnlisten) {
        this.storeUnlisten = useWorkbenchStore.subscribe((state) => this.syncWatched(state.tabs));
        this.syncWatched(useWorkbenchStore.getState().tabs);
      }
      return;
    }
    this.storeUnlisten?.();
    this.storeUnlisten = null;
    for (const watcher of this.watchers.values()) watcher.unlisten();
    this.watchers.clear();
  }

  private syncWatched(tabs: TabItem[]): void {
    const paths = new Set<string>();
    for (const tab of tabs) {
      if (typeof tab.path === "string" && tab.path.length > 0) paths.add(tab.path);
    }
    for (const [path, watcher] of this.watchers) {
      if (paths.has(path)) continue;
      watcher.unlisten();
      this.watchers.delete(path);
      if (watcher.lastDocument) this.fireClose(watcher.lastDocument);
    }
    for (const path of paths) {
      if (this.watchers.has(path)) continue;
      const watcher: PathWatcher = {
        unlisten: () => {},
        seen: false,
        lastVersion: -1,
        lastDirty: false,
        lastContent: "",
        lastDocument: null,
      };
      watcher.unlisten = DocumentService.subscribe(path, (record) =>
        this.handleRecord(watcher, record),
      );
      this.watchers.set(path, watcher);
    }
  }

  private handleRecord(watcher: PathWatcher, record: DocumentRecord | undefined): void {
    if (!record) {
      if (watcher.lastDocument) {
        const document = watcher.lastDocument;
        watcher.lastDocument = null;
        watcher.seen = false;
        this.fireClose(document);
      }
      return;
    }
    const isFirst = !watcher.seen;
    const changed =
      !isFirst &&
      (record.content !== watcher.lastContent ||
        record.version !== watcher.lastVersion ||
        record.isDirty !== watcher.lastDirty);
    watcher.seen = true;
    watcher.lastVersion = record.version;
    watcher.lastDirty = record.isDirty;
    watcher.lastContent = record.content;
    const document = this.toTextDocument(record);
    watcher.lastDocument = document;
    if (isFirst) {
      for (const listener of this.openListeners) listener(document);
    } else if (changed) {
      const event: TextDocumentChangeEvent = {
        document,
        contentChanges: [{ text: record.content }],
      };
      for (const listener of this.changeListeners) listener(event);
    }
  }

  private fireClose(document: VSCodeTextDocument): void {
    for (const listener of this.closeListeners) listener(document);
  }

  private toTextDocument(record: DocumentRecord): VSCodeTextDocument {
    return {
      uri: Uri.file(record.path),
      fileName: record.path,
      languageId: record.languageId,
      version: record.version,
      isDirty: record.isDirty,
      getText: () => record.content,
    };
  }
}

const documentEventRelay = new DocumentEventRelay();

/** vscode Position（line/character，utf16 单位）→ 全文 utf16 偏移 */
function utf16OffsetAt(text: string, line: number, character: number): number {
  const lines = text.split("\n");
  const safeLine = Math.max(0, Math.min(line, lines.length - 1));
  let offset = 0;
  for (let index = 0; index < safeLine; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset + Math.max(0, Math.min(character, lines[safeLine]?.length ?? 0));
}

/** 按位置插入：优先走 DocumentService.applyEdit（utf16 偏移），未打开的文档退化为光标插入 */
async function insertAtPosition(path: string, position: Position, text: string): Promise<void> {
  const record = DocumentService.get(path);
  if (!record) {
    EditorAdapter.insertCode(text);
    return;
  }
  const current = record.content;
  const offset = Math.max(
    0,
    Math.min(utf16OffsetAt(current, position.line, position.character), current.length),
  );
  const nextContent = current.slice(0, offset) + text + current.slice(offset);
  await DocumentService.applyEdit(path, offset, offset, text, nextContent);
}

function parentPath(path: string): string | null {
  const normalized = path.replace(/[\\/]+$/, "");
  const cut = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return cut > 0 ? normalized.slice(0, cut) : null;
}

/** 现有 IPC 无文件元数据命令：用父目录 readDirectory 判别文件/目录类型 */
async function statType(path: string): Promise<FileType> {
  const parent = parentPath(path);
  if (!parent) return FileType.File;
  try {
    const entries = await FileSystemCommands.readDirectory(parent);
    const name = path.split(/[\\/]/).pop() ?? "";
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) return FileType.File;
    return entry.isDirectory ? FileType.Directory : FileType.File;
  } catch {
    return FileType.File;
  }
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
    FileType,
    StatusBarAlignment,

    languages: {
      createDiagnosticCollection(name: string): DiagnosticCollection {
        return new DiagnosticCollectionImpl(name);
      },
      DiagnosticSeverity,
    },

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
        const docPath: string = activeTab.path;

        const editorStatus = EditorAdapter.getStatus();
        return {
          document: {
            uri: Uri.file(activeTab.path),
            fileName: activeTab.path,
            languageId: GetLanguageFromPath(activeTab.path),
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
              const pendingInserts: { position: Position; text: string }[] = [];
              const editBuilder: TextEditorEdit = {
                replace(range: Range, text: string) {
                  EditorAdapter.replaceRange(range.start.line, range.end.line, text);
                },
                insert(position: Position, text: string) {
                  // 先收集，回调返回后按位置经 DocumentService 落盘（utf16 偏移换算）
                  pendingInserts.push({ position, text });
                },
                delete(range: Range) {
                  EditorAdapter.replaceRange(range.start.line, range.end.line, "");
                },
              };
              callback(editBuilder);
              for (const operation of pendingInserts) {
                await insertAtPosition(docPath, operation.position, operation.text);
              }
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

      onDidOpenTextDocument(listener: (document: VSCodeTextDocument) => void): Disposable {
        return new Disposable(documentEventRelay.onDidOpenTextDocument(listener));
      },

      onDidChangeTextDocument(listener: (event: TextDocumentChangeEvent) => void): Disposable {
        return new Disposable(documentEventRelay.onDidChangeTextDocument(listener));
      },

      onDidCloseTextDocument(listener: (document: VSCodeTextDocument) => void): Disposable {
        return new Disposable(documentEventRelay.onDidCloseTextDocument(listener));
      },

      getConfiguration(section?: string) {
        const knownKey = async (key: string): Promise<string | undefined> => {
          const config = (await UserConfigStore.get()) as unknown as Record<string, unknown>;
          return resolveConfigKey(section, key).find(
            (candidate) => config[candidate] !== undefined,
          );
        };

        return {
          async get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
            const config = (await UserConfigStore.get()) as unknown as Record<string, unknown>;
            for (const candidate of resolveConfigKey(section, key)) {
              const value = config[candidate];
              if (value !== undefined) return value as T;
            }
            return defaultValue;
          },
          async update(key: string, value: unknown): Promise<void> {
            // 只允许写回已存在的配置项：扩展不得向 user-config.json 注入未知字段
            const target = await knownKey(key);
            if (target === undefined) {
              throw new Error(`拒绝写入未知配置项: ${resolveConfigKey(section, key).join(" / ")}`);
            }
            await UserConfigStore.set({ [target]: value } as Partial<UserConfig>);
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
          if (!exists) {
            return { type: FileType.Unknown, size: 0, mtime: 0 };
          }
          // 后端尚无文件元数据命令：type 经父目录判别；size/mtime 暂无真实来源（读全量内容代价过高），先返回占位值
          const type = await statType(uri.fsPath);
          return {
            type,
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

/**
 * 执行 VS Code 扩展的 activate(context) 流程：
 * 创建上下文并把 activate 返回的 Disposable（单个或数组）自动收进 subscriptions。
 */
export async function activateVSCodeExtension(
  extensionId: string,
  activate: (context: VSCodeExtensionContext) => unknown,
): Promise<VSCodeExtensionContext> {
  const context: VSCodeExtensionContext = {
    extensionPath: extensionId,
    extensionUri: Uri.file(extensionId),
    subscriptions: [],
  };
  const returned = await activate(context);
  const candidates = Array.isArray(returned) ? returned : [returned];
  for (const candidate of candidates) {
    if (candidate && typeof (candidate as Disposable).dispose === "function") {
      context.subscriptions.push(candidate as Disposable);
    }
  }
  return context;
}

/** 扩展禁用/停用：逆序 dispose subscriptions，避免依赖注册顺序的释放问题 */
export function deactivateVSCodeExtension(context: VSCodeExtensionContext): void {
  for (const disposable of [...context.subscriptions].reverse()) {
    disposable.dispose();
  }
  context.subscriptions.length = 0;
}
