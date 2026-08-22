/**
 * Aurona Code 官方原生 SDK 运行时宿主 (AuronaSDKHost)
 * 为 WASM 扩展与原生 Aurona 插件提供现代化、类型安全的 SDK API
 */

import { EditorAdapter } from "../../../Core/Editor/EditorAdapter";
import { StatusBarRegistry } from "../../../Core/StatusBar/StatusBarRegistry";
import { CommandRegistry } from "../../../Extension/CommandRegistry";
import { EventBus } from "../../../Foundation/EventBus";
import { LocaleService } from "../../../Foundation/I18n";
import { PlatformService } from "../../../Foundation/Platform";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";

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

import {
  ExtensionFliunoRegistry,
  type FliunoCustomItem,
  type FliunoCustomProvider,
} from "../../../Core/Fliuno/ExtensionFliunoRegistry";

export type { FliunoCustomItem, FliunoCustomProvider };
export { ExtensionFliunoRegistry };

export interface AuronaSDK {
  version: string;
  workspace: {
    getActiveDocument(): AuronaDocument | null;
    applyEdits(edits: TextEditOperation[]): Promise<boolean>;
    saveActiveDocument(): Promise<boolean>;
    openFile(path: string): Promise<void>;
  };
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
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set<T = unknown>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  fliuno: {
    registerProvider(provider: FliunoCustomProvider): () => void;
  };
  commands: {
    register(command: {
      id: string;
      title: string;
      category?: string;
      handler: (...args: unknown[]) => void | Promise<void>;
    }): () => void;
    execute(id: string, ...args: unknown[]): Promise<unknown>;
  };
  env: {
    platform: string;
    locale: string;
    sdkVersion: string;
  };
}

/**
 * 为指定扩展创建沙箱隔离的 Aurona SDK 实例
 */
export function createAuronaSDKHost(extensionId: string): AuronaSDK {
  // 基于 Extension ID 的独立沙箱内存/持久化存储镜像
  const inMemoryStorage = new Map<string, unknown>();

  return {
    version: "1.1.0",

    workspace: {
      getActiveDocument(): AuronaDocument | null {
        const state = useWorkbenchStore.getState();
        const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
        if (activeTab?.type !== "file" || !activeTab.path) {
          return null;
        }

        const editorStatus = EditorAdapter.getStatus();
        return {
          path: activeTab.path,
          languageId: activeTab.path.split(".").pop() || "plaintext",
          getText() {
            return EditorAdapter.getText();
          },
          isDirty: activeTab.isDirty ?? false,
          cursor: {
            line: editorStatus.line,
            column: editorStatus.column,
          },
        };
      },

      async applyEdits(edits: TextEditOperation[]): Promise<boolean> {
        try {
          for (const edit of edits) {
            EditorAdapter.replaceRange(edit.range.startLine, edit.range.endLine, edit.newText);
          }
          return true;
        } catch {
          return false;
        }
      },

      async saveActiveDocument(): Promise<boolean> {
        EventBus.emit("app:save-file", undefined);
        return true;
      },

      async openFile(path: string): Promise<void> {
        useWorkbenchStore.getState().openTab({
          id: path,
          type: "file",
          title: path.split(/[\\/]/).pop() || "file",
          path,
        });
      },
    },

    ui: {
      showToast(options) {
        EventBus.emit("app:toast", {
          type: options.type ?? "info",
          title: `[${extensionId}]`,
          message: options.message,
        });
      },

      createStatusBarItem(options) {
        const itemId =
          options.id || `sdk.ext.${extensionId}.${Math.random().toString(36).slice(2, 8)}`;
        const handle = StatusBarRegistry.createItem({
          id: itemId,
          alignment: options.alignment ?? "right",
          priority: options.priority ?? 0,
          text: options.text,
          tooltip: options.tooltip,
          onClick: options.onClick,
          visible: true,
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
    },

    storage: {
      async get<T = unknown>(key: string): Promise<T | null> {
        if (inMemoryStorage.has(key)) {
          return inMemoryStorage.get(key) as T;
        }
        return null;
      },

      async set<T = unknown>(key: string, value: T): Promise<void> {
        inMemoryStorage.set(key, value);
      },

      async delete(key: string): Promise<void> {
        inMemoryStorage.delete(key);
      },

      async clear(): Promise<void> {
        inMemoryStorage.clear();
      },
    },

    fliuno: {
      registerProvider(provider: FliunoCustomProvider): () => void {
        return ExtensionFliunoRegistry.register(provider);
      },
    },

    commands: {
      register(command): () => void {
        return CommandRegistry.register({
          id: command.id,
          title: command.title,
          category: command.category || extensionId,
          handler: command.handler,
        });
      },

      async execute(id: string, ...args: unknown[]): Promise<unknown> {
        const res = await CommandRegistry.execute(id, ...args);
        return res.ok;
      },
    },

    env: {
      get platform() {
        return PlatformService.current();
      },
      get locale() {
        return LocaleService.get();
      },
      sdkVersion: "1.1.0",
    },
  };
}
