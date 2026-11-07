import type { TabItem } from "../../../Foundation/Types/Tab";
import type { FliunoCustomProvider } from "../../Fliuno/ExtensionFliunoRegistry";

export interface AuronaDocument {
  path: string;
  languageId: string;
  getText(): string;
  isDirty: boolean;
  cursor: { line: number; column: number };
}

export interface TextEditOperation {
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  newText: string;
}

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
}

export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
  canPickMany?: boolean;
}

export interface InputBoxOptions {
  title?: string;
  placeholder?: string;
  value?: string;
  prompt?: string;
  password?: boolean;
}

export interface OutputChannel {
  name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface DiagnosticItem {
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  source?: string;
}

export interface ExtensionHostPorts {
  workbench(): { tabs: readonly TabItem[]; activeTabId: string | null };
  openFile(path: string): void;
  showOutput(): void;
  notify(message: string, type: "info" | "warning" | "error" | "success"): void;
  quickPick(
    extensionId: string,
    items: QuickPickItem[],
    options?: QuickPickOptions,
  ): Promise<QuickPickItem | undefined>;
  inputBox(extensionId: string, options?: InputBoxOptions): Promise<string | undefined>;
}

export interface AuronaSDK {
  dispose(): void;
  version: string;

  /**
   * 文档与工作区管理器
   */
  workspace: {
    getActiveDocument(): AuronaDocument | null;
    getOpenDocuments(): AuronaDocument[];
    applyEdits(edits: TextEditOperation[]): Promise<boolean>;
    saveActiveDocument(): Promise<boolean>;
    openFile(path: string): Promise<void>;
    onDidOpenTextDocument(callback: (doc: AuronaDocument) => void): () => void;
    onDidChangeTextDocument(
      callback: (e: { document: AuronaDocument; content: string }) => void,
    ): () => void;
    onDidSaveTextDocument(callback: (doc: AuronaDocument) => void): () => void;
    onDidCloseTextDocument(callback: (path: string) => void): () => void;
  };

  /**
   * 窗口、交互与模态反馈
   */
  window: {
    showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
    showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
    showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
    showQuickPick(
      items: string[] | QuickPickItem[],
      options?: QuickPickOptions,
    ): Promise<string | QuickPickItem | undefined>;
    showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
    createStatusBarItem(options: {
      id?: string;
      text: string;
      alignment?: "left" | "right";
      priority?: number;
      tooltip?: string;
      onClick?: () => void | Promise<void>;
    }): {
      text: string;
      tooltip?: string;
      show(): void;
      hide(): void;
      dispose(): void;
    };
    createOutputChannel(name: string): OutputChannel;
  };

  /**
   * 保持旧版兼容的 ui 模块
   */
  ui: {
    showToast(options: {
      message: string;
      type?: "info" | "success" | "warning" | "error";
      duration?: number;
    }): void;
    createStatusBarItem(options: {
      id?: string;
      text: string;
      alignment?: "left" | "right";
      priority?: number;
      tooltip?: string;
      onClick?: () => void | Promise<void>;
    }): {
      text: string;
      tooltip?: string;
      show(): void;
      hide(): void;
      dispose(): void;
    };
  };

  /**
   * 沙箱持久化独立存储
   */
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set<T = unknown>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    keys(): Promise<string[]>;
    onDidChange(callback: (key: string, value: unknown) => void): () => void;
  };

  /**
   * Fliuno 聚合检索
   */
  fliuno: {
    registerProvider(provider: FliunoCustomProvider): () => void;
  };

  /**
   * 命令系统
   */
  commands: {
    register(command: {
      id: string;
      title: string;
      category?: string;
      handler: (...args: unknown[]) => void | Promise<void>;
    }): () => void;
    execute(id: string, ...args: unknown[]): Promise<unknown>;
  };

  /**
   * 原生权限系统
   */
  permissions: {
    check(permission: string): Promise<"granted" | "denied" | "unknown">;
    request(permission: string, options?: { prompt?: string }): Promise<boolean>;
    revoke(permission: string): Promise<void>;
  };

  /**
   * 事件总线
   */
  events: {
    on(eventName: string, handler: (payload: unknown) => void): () => void;
    emit(eventName: string, payload?: unknown): void;
  };

  /**
   * 主题与色彩
   */
  theme: {
    getThemeMode(): "dark" | "light" | "system";
  };

  /**
   * 运行环境与剪贴板
   */
  env: {
    platform: string;
    locale: string;
    sdkVersion: string;
    appName: string;
    appVersion: string;
    clipboard: {
      readText(): Promise<string>;
      writeText(text: string): Promise<void>;
    };
    openExternal(url: string): Promise<void>;
  };
}
