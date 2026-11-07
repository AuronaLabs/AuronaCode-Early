import type {
  AuronaDocument,
  AuronaSDK,
  ExtensionHostPorts,
  InputBoxOptions,
  OutputChannel,
  QuickPickItem,
  QuickPickOptions,
  TextEditOperation,
} from "./HostContracts";

export type * from "./HostContracts";

/**
 * Aurona Code 官方原生 SDK 运行时宿主 (AuronaSDKHost) v2.0.0
 * 为 WASM 扩展与原生 Aurona 插件提供现代化、全方位、类型安全的 SDK API 矩阵
 */

import { CommandRegistry } from "../../../Core/Commands/CommandRegistry";
import {
  type DocumentRecord,
  DocumentService,
  prepareDocumentEdits,
} from "../../../Core/Documents";
import { EditorAdapter } from "../../../Core/Editor/EditorAdapter";
import {
  ExtensionFliunoRegistry,
  type FliunoCustomItem,
  type FliunoCustomProvider,
} from "../../../Core/Fliuno/ExtensionFliunoRegistry";
import { OutputService } from "../../../Core/OutputService";
import { StatusBarRegistry } from "../../../Core/StatusBar/StatusBarRegistry";
import { LocaleService } from "../../../Foundation/I18n";
import { ExtensionIPC } from "../../../Foundation/IPC/ExtensionCommands";
import { DisposableScope } from "../../../Foundation/Lifecycle/DisposableScope";
import { PlatformService } from "../../../Foundation/Platform";
import type { TabItem } from "../../../Foundation/Types/Tab";
import { GetLanguageFromPath } from "../../../Shared/Utils/LanguageUtils";

export type { FliunoCustomItem, FliunoCustomProvider };
export { ExtensionFliunoRegistry };

function sdkDocument(record: DocumentRecord): AuronaDocument {
  return {
    path: record.path,
    languageId: record.languageId,
    isDirty: record.isDirty,
    cursor: { line: 1, column: 1 },
    getText: () => record.content,
  };
}

/**
 * 为指定扩展创建沙箱隔离的 Aurona SDK 2.0 实例
 */
export function createAuronaSDKHost(extensionId: string, ports: ExtensionHostPorts): AuronaSDK {
  const scope = new DisposableScope();
  const own = (dispose: () => void) => {
    let disposed = false;
    const once = () => {
      if (!disposed) {
        disposed = true;
        dispose();
      }
    };
    scope.add(once);
    return once;
  };
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
    dispose() {
      try {
        scope.dispose();
      } finally {
        storageChangeListeners.clear();
        customEventListeners.clear();
        inMemoryStorage.clear();
      }
    },

    workspace: {
      getActiveDocument(): AuronaDocument | null {
        const state = ports.workbench();
        const activeTab = state.tabs.find((tab: TabItem) => tab.id === state.activeTabId);
        if (activeTab?.type !== "file" || !activeTab.path) {
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
        const state = ports.workbench();
        const validTabs = state.tabs.filter(
          (t: TabItem) => t.type === "file" && typeof t.path === "string" && t.path.length > 0,
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
        const state = ports.workbench();
        const activeTab = state.tabs.find((tab: TabItem) => tab.id === state.activeTabId);
        if (activeTab?.type !== "file" || !activeTab.path) return false;

        await DocumentService.flush(activeTab.path);
        const record = DocumentService.get(activeTab.path);
        if (!record) return false;
        const next = prepareDocumentEdits(record.content, edits);
        await DocumentService.applyEdits(
          activeTab.path,
          next.edits,
          next.content,
          "external",
          record.version,
        );
        return true;
      },

      async saveActiveDocument(): Promise<boolean> {
        const state = ports.workbench();
        const activeTab = state.tabs.find((tab: TabItem) => tab.id === state.activeTabId);
        if (activeTab?.type !== "file" || !activeTab.path) return false;
        await DocumentService.save(activeTab.path);
        return true;
      },

      async openFile(path: string): Promise<void> {
        ports.openFile(path);
      },

      onDidOpenTextDocument(callback: (doc: AuronaDocument) => void): () => void {
        return own(
          DocumentService.subscribeEvents((event) => {
            if (event.type === "opened") callback(sdkDocument(event.document));
          }),
        );
      },
      onDidChangeTextDocument(
        callback: (event: { document: AuronaDocument; content: string }) => void,
      ): () => void {
        return own(
          DocumentService.subscribeEvents((event) => {
            if (event.type === "changed")
              callback({ document: sdkDocument(event.document), content: event.document.content });
          }),
        );
      },
      onDidSaveTextDocument(callback: (doc: AuronaDocument) => void): () => void {
        return own(
          DocumentService.subscribeEvents((event) => {
            if (event.type === "saved") callback(sdkDocument(event.document));
          }),
        );
      },
      onDidCloseTextDocument(callback: (path: string) => void): () => void {
        return own(
          DocumentService.subscribeEvents((event) => {
            if (event.type === "closed") callback(event.document.path);
          }),
        );
      },
    },

    window: {
      async showInformationMessage(
        message: string,
        ...items: string[]
      ): Promise<string | undefined> {
        ports.notify(message, "info");
        return items[0];
      },

      async showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
        ports.notify(message, "warning");
        return items[0];
      },

      async showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
        ports.notify(message, "error");
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
        const picked = await ports.quickPick(extensionId, normalized, options);
        if (!picked) return undefined;
        // 字符串入参约定返回字符串，对象入参返回完整 QuickPickItem（与 VS Code 对齐）
        return typeof items[0] === "string" ? picked.label : picked;
      },

      async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
        return ports.inputBox(extensionId, options);
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

        const dispose = own(() => handle.dispose());
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
            dispose();
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
            ports.showOutput();
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
        ports.notify(options.message, options.type || "info");
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
        return own(() => {
          storageChangeListeners.delete(callback);
        });
      },
    },

    fliuno: {
      registerProvider(provider: FliunoCustomProvider): () => void {
        return own(ExtensionFliunoRegistry.register(provider));
      },
    },

    commands: {
      register(command) {
        return own(
          CommandRegistry.register({
            id: command.id,
            title: command.title,
            category: command.category || "Extension",
            handler: command.handler,
          }),
        );
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
        return own(() => {
          set?.delete(handler);
          if (set?.size === 0) customEventListeners.delete(eventName);
        });
      },
      emit(eventName: string, payload?: unknown): void {
        const set = customEventListeners.get(eventName);
        if (set && !scope.isDisposed) {
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
