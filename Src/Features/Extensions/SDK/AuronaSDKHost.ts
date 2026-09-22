/**
 * Aurona Code 官方原生 SDK 运行时宿主 (AuronaSDKHost) v2.0.0
 * 为 WASM 扩展与原生 Aurona 插件提供现代化、全方位、类型安全的 SDK API 矩阵
 */

import { DocumentService } from "../../../Core/DocumentService";
import { EditorAdapter } from "../../../Core/Editor/EditorAdapter";
import {
  ExtensionFliunoRegistry,
  type FliunoCustomItem,
  type FliunoCustomProvider,
} from "../../../Core/Fliuno/ExtensionFliunoRegistry";
import { OutputService } from "../../../Core/OutputService";
import { StatusBarRegistry } from "../../../Core/StatusBar/StatusBarRegistry";
import { CommandRegistry } from "../../../Extension/CommandRegistry";
import { LocaleService } from "../../../Foundation/I18n";
import { ExtensionIPC } from "../../../Foundation/IPC/ExtensionCommands";
import { PlatformService } from "../../../Foundation/Platform";
import type { TabItem } from "../../../Foundation/Types/Tab";
import { GetLanguageFromPath } from "../../../Shared/Utils/LanguageUtils";
import { useWorkbenchStore, type WorkbenchState } from "../../../State/useWorkspaceStore";
import { showToast } from "../../../UI/Feedback/Toast";
import { showSdkInputBox, showSdkQuickPick } from "./SdkHostDialogs";

export type { FliunoCustomItem, FliunoCustomProvider };
export { ExtensionFliunoRegistry };

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

export interface AuronaSDK {
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

/**
 * 为指定扩展创建沙箱隔离的 Aurona SDK 2.0 实例
 */
export function createAuronaSDKHost(extensionId: string): AuronaSDK {
  const inMemoryStorage = new Map<string, unknown>();
  const storageChangeListeners = new Set<(key: string, value: unknown) => void>();
  const customEventListeners = new Map<string, Set<(payload: unknown) => void>>();

  const storagePrefix = `aurona.ext.storage.${extensionId}.`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(storagePrefix)) {
        const subKey = k.slice(storagePrefix.length);
        const val = localStorage.getItem(k);
        if (val !== null) {
          try {
            inMemoryStorage.set(subKey, JSON.parse(val));
          } catch {
            inMemoryStorage.set(subKey, val);
          }
        }
      }
    }
  } catch {
    // 忽略 SSR 或安全上下文
  }

  const sdk: AuronaSDK = {
    version: "1",

    workspace: {
      getActiveDocument(): AuronaDocument | null {
        const state = useWorkbenchStore.getState();
        const activeTab = state.tabs.find((tab: TabItem) => tab.id === state.activeTabId);
        if (!activeTab?.path) {
          return null;
        }

        const docPath = activeTab.path;
        const docRecord = DocumentService.get(docPath);
        const editorText = EditorAdapter.getText();
        const content = docRecord ? docRecord.content : editorText;
        const status = EditorAdapter.getStatus();

        return {
          path: docPath,
          languageId: docRecord?.languageId || GetLanguageFromPath(docPath),
          isDirty: Boolean(activeTab.isDirty),
          cursor: { line: status.line, column: status.column },
          getText: () => content,
        };
      },

      getOpenDocuments(): AuronaDocument[] {
        const state = useWorkbenchStore.getState();
        const validTabs = state.tabs.filter(
          (t: TabItem) => typeof t.path === "string" && t.path.length > 0,
        );
        return validTabs.map((tab: TabItem) => {
          const docPath = tab.path ?? "";
          const docRecord = DocumentService.get(docPath);
          return {
            path: docPath,
            languageId: docRecord?.languageId || GetLanguageFromPath(docPath),
            isDirty: Boolean(tab.isDirty),
            cursor: { line: 1, column: 1 },
            getText: () => docRecord?.content || "",
          };
        });
      },

      async applyEdits(edits: TextEditOperation[]): Promise<boolean> {
        const state = useWorkbenchStore.getState();
        const activeTab = state.tabs.find((tab: TabItem) => tab.id === state.activeTabId);
        if (!activeTab?.path) return false;

        const docRecord = DocumentService.get(activeTab.path);
        let content = docRecord ? docRecord.content : EditorAdapter.getText();

        const sortedEdits = [...edits].sort((a, b) => {
          if (a.range.startLine !== b.range.startLine) {
            return b.range.startLine - a.range.startLine;
          }
          return b.range.startColumn - a.range.startColumn;
        });

        for (const edit of sortedEdits) {
          const lines = content.split("\n");
          const { startLine, startColumn, endLine, endColumn } = edit.range;
          const sLineIdx = Math.max(0, startLine - 1);
          const eLineIdx = Math.max(0, endLine - 1);

          if (sLineIdx >= lines.length) continue;

          const before = lines[sLineIdx].slice(0, Math.max(0, startColumn - 1));
          const after = lines[eLineIdx] ? lines[eLineIdx].slice(Math.max(0, endColumn - 1)) : "";

          lines.splice(sLineIdx, eLineIdx - sLineIdx + 1, before + edit.newText + after);
          content = lines.join("\n");
        }

        EditorAdapter.replaceRange(1, Math.max(1, content.split("\n").length), content);
        return true;
      },

      async saveActiveDocument(): Promise<boolean> {
        const state = useWorkbenchStore.getState();
        const activeTab = state.tabs.find((tab: TabItem) => tab.id === state.activeTabId);
        if (!activeTab?.path) return false;
        await DocumentService.save(activeTab.path);
        return true;
      },

      async openFile(path: string): Promise<void> {
        useWorkbenchStore.getState().openFile(path);
      },

      onDidOpenTextDocument(callback: (doc: AuronaDocument) => void): () => void {
        return useWorkbenchStore.subscribe((state: WorkbenchState, prevState: WorkbenchState) => {
          if (state.activeTabId !== prevState.activeTabId) {
            const doc = sdk.workspace.getActiveDocument();
            if (doc) callback(doc);
          }
        });
      },

      onDidChangeTextDocument(
        callback: (e: { document: AuronaDocument; content: string }) => void,
      ): () => void {
        return EditorAdapter.onStatusChange(() => {
          const doc = sdk.workspace.getActiveDocument();
          if (doc) callback({ document: doc, content: EditorAdapter.getText() });
        });
      },

      onDidSaveTextDocument(callback: (doc: AuronaDocument) => void): () => void {
        return useWorkbenchStore.subscribe((state: WorkbenchState) => {
          const activeTab = state.tabs.find((t: TabItem) => t.id === state.activeTabId);
          if (activeTab && !activeTab.isDirty) {
            const doc = sdk.workspace.getActiveDocument();
            if (doc) callback(doc);
          }
        });
      },

      onDidCloseTextDocument(callback: (path: string) => void): () => void {
        return useWorkbenchStore.subscribe((state: WorkbenchState, prevState: WorkbenchState) => {
          if (state.tabs.length < prevState.tabs.length) {
            const closed = prevState.tabs.find(
              (pt: TabItem) => !state.tabs.some((st: TabItem) => st.id === pt.id),
            );
            if (closed?.path) callback(closed.path);
          }
        });
      },
    },

    window: {
      async showInformationMessage(
        message: string,
        ...items: string[]
      ): Promise<string | undefined> {
        showToast(message, "info");
        return items[0];
      },

      async showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
        showToast(message, "warning");
        return items[0];
      },

      async showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
        showToast(message, "error");
        return items[0];
      },

      async showQuickPick(
        items: string[] | QuickPickItem[],
        options?: QuickPickOptions,
      ): Promise<string | QuickPickItem | undefined> {
        const normalized = (items ?? []).map((item) =>
          typeof item === "string" ? { label: item } : item,
        );
        if (normalized.length === 0) return undefined;
        const picked = await showSdkQuickPick(extensionId, normalized, options);
        if (!picked) return undefined;
        // 字符串入参约定返回字符串，对象入参返回完整 QuickPickItem（与 VS Code 对齐）
        return typeof items[0] === "string" ? picked.label : picked;
      },

      async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
        return showSdkInputBox(extensionId, options);
      },

      createStatusBarItem(options) {
        const id =
          options.id || `ext-status-${extensionId}-${Math.random().toString(36).slice(2, 7)}`;
        const handle = StatusBarRegistry.createItem({
          id,
          text: options.text,
          tooltip: options.tooltip,
          alignment: options.alignment || "right",
          priority: options.priority ?? 50,
          onClick: options.onClick,
        });

        return {
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

      createOutputChannel(name: string): OutputChannel {
        // 扩展专属动态频道：ensureExtensionChannel 会归一化到 extension: 命名空间
        const channelId = OutputService.ensureExtensionChannel(`${extensionId}.${name}`, name);
        return {
          name,
          append(value: string) {
            OutputService.append(channelId, value, "info");
          },
          appendLine(value: string) {
            OutputService.append(channelId, value, "info");
          },
          clear() {
            OutputService.clear(channelId);
          },
          show() {
            useWorkbenchStore.getState().setActiveBottomPanel("output");
          },
          hide() {},
          dispose() {
            // 频道历史保留在输出面板中，不做删除
          },
        };
      },
    },

    ui: {
      showToast(options) {
        showToast(options.message, options.type || "info");
      },
      createStatusBarItem(options) {
        return sdk.window.createStatusBarItem(options);
      },
    },

    storage: {
      async get<T = unknown>(key: string): Promise<T | null> {
        if (inMemoryStorage.has(key)) {
          return inMemoryStorage.get(key) as T;
        }
        try {
          const raw = localStorage.getItem(storagePrefix + key);
          if (raw !== null) {
            const parsed = JSON.parse(raw);
            inMemoryStorage.set(key, parsed);
            return parsed as T;
          }
        } catch {
          // ignore
        }
        return null;
      },

      async set<T = unknown>(key: string, value: T): Promise<void> {
        inMemoryStorage.set(key, value);
        try {
          localStorage.setItem(storagePrefix + key, JSON.stringify(value));
        } catch {
          // ignore
        }
        for (const listener of storageChangeListeners) {
          listener(key, value);
        }
      },

      async delete(key: string): Promise<void> {
        inMemoryStorage.delete(key);
        try {
          localStorage.removeItem(storagePrefix + key);
        } catch {
          // ignore
        }
        for (const listener of storageChangeListeners) {
          listener(key, null);
        }
      },

      async clear(): Promise<void> {
        inMemoryStorage.clear();
        try {
          const toRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith(storagePrefix)) toRemove.push(k);
          }
          for (const k of toRemove) localStorage.removeItem(k);
        } catch {
          // ignore
        }
      },

      async keys(): Promise<string[]> {
        return Array.from(inMemoryStorage.keys());
      },

      onDidChange(callback: (key: string, value: unknown) => void): () => void {
        storageChangeListeners.add(callback);
        return () => {
          storageChangeListeners.delete(callback);
        };
      },
    },

    fliuno: {
      registerProvider(provider: FliunoCustomProvider): () => void {
        return ExtensionFliunoRegistry.register(provider);
      },
    },

    commands: {
      register(command) {
        return CommandRegistry.register({
          id: command.id,
          title: command.title,
          category: command.category || "Extension",
          handler: command.handler,
        });
      },

      async execute(id: string, ...args: unknown[]): Promise<unknown> {
        const result = await CommandRegistry.execute(id, args[0]);
        return result.ok;
      },
    },

    permissions: {
      async check(permission: string): Promise<"granted" | "denied" | "unknown"> {
        try {
          const detail = await ExtensionIPC.getPermission(extensionId, permission);
          return detail.state;
        } catch {
          // 后端不可用（如测试环境）时按未授权处理
          return "unknown";
        }
      },

      async request(permission: string, _options?: { prompt?: string }): Promise<boolean> {
        try {
          const detail = await ExtensionIPC.getPermission(extensionId, permission);
          if (detail.state === "granted") return true;
          if (detail.state === "denied") return false;
          // 未决定（unknown）时授予会话级权限，不影响持久授权记录
          await ExtensionIPC.setSessionPermission(extensionId, permission, true);
          return true;
        } catch {
          return false;
        }
      },

      async revoke(permission: string): Promise<void> {
        try {
          await ExtensionIPC.revokePermission(extensionId, permission);
        } catch {
          // 后端不可用时忽略
        }
      },
    },

    events: {
      on(eventName: string, handler: (payload: unknown) => void): () => void {
        let set = customEventListeners.get(eventName);
        if (!set) {
          set = new Set();
          customEventListeners.set(eventName, set);
        }
        set.add(handler);
        return () => {
          set?.delete(handler);
        };
      },
      emit(eventName: string, payload?: unknown): void {
        const set = customEventListeners.get(eventName);
        if (set) {
          for (const handler of set) {
            handler(payload);
          }
        }
      },
    },

    theme: {
      getThemeMode(): "dark" | "light" | "system" {
        // system 由应用启动流程归约为 documentElement 上的实际 dark 类
        return document.documentElement.classList.contains("dark") ? "dark" : "light";
      },
    },

    env: {
      platform: PlatformService.current(),
      locale: LocaleService.get(),
      sdkVersion: "1",
      appName: "Aurona Code",
      appVersion: import.meta.env.VITE_APP_VERSION as string,
      clipboard: {
        async readText(): Promise<string> {
          try {
            return await navigator.clipboard.readText();
          } catch {
            return "";
          }
        },
        async writeText(text: string): Promise<void> {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            // ignore
          }
        },
      },
      async openExternal(url: string): Promise<void> {
        window.open(url, "_blank");
      },
    },
  };

  return sdk;
}
