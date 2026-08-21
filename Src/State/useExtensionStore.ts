import { create } from "zustand";
import {
  type ExtensionDescriptor,
  ExtensionIPC,
  type ExtensionPermissionState,
  type ExtensionViewPayload,
} from "../Foundation/IPC/ExtensionCommands";

const HIDDEN_EXTENSIONS_STORAGE_KEY = "aurona:hidden-extensions";

interface ExtensionStoreState {
  descriptors: ExtensionDescriptor[];
  hiddenExtensionIds: string[];
  views: Record<string, ExtensionViewPayload | undefined>;
  permissions: Record<string, ExtensionPermissionState | undefined>;
  initialized: boolean;
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  viewFor(extensionId: string): Promise<ExtensionViewPayload | undefined>;
  permissionFor(extensionId: string, permission: string): Promise<ExtensionPermissionState>;
  setPermission(
    extensionId: string,
    permission: string,
    granted: boolean,
  ): Promise<ExtensionPermissionState>;
  hideExtension(extensionId: string): void;
  restoreExtension(extensionId: string): void;
}

const permissionKey = (extensionId: string, permission: string) => `${extensionId}:${permission}`;

function loadHiddenExtensions(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_EXTENSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHiddenExtensions(ids: string[]): void {
  try {
    localStorage.setItem(HIDDEN_EXTENSIONS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 忽略存储异常
  }
}

export const BUILTIN_DESCRIPTORS: ExtensionDescriptor[] = [
  {
    id: "aurona.markdown",
    name: "Markdown Live Preview",
    displayName: {
      "zh-CN": "Markdown 实时预览",
      "zh-Hant": "Markdown 即時預覽",
      en: "Markdown Preview",
    },
    publisher: "aurona",
    version: "0.1.0",
    description: "High-performance streaming Markdown preview engine with GitHub styling",
    displayDescription: {
      "zh-CN": "原生 WASM 极速流式 Markdown 渲染引擎",
      "zh-Hant": "原生 WASM 極速串流 Markdown 渲染引擎",
      en: "High-performance streaming Markdown preview engine",
    },
    sidebarTitle: "Markdown",
    displayTitle: {
      "zh-CN": "Markdown 预览",
      "zh-Hant": "Markdown 預覽",
      en: "Markdown Preview",
    },
    sidebarIcon: "assets/icon.svg",
    viewEntry: "ui/index.html",
  },
  {
    id: "aurona.planner",
    name: "Task & Test Planner",
    displayName: {
      "zh-CN": "先锋计划任务看板",
      "zh-Hant": "先鋒計畫任務看板",
      en: "Pioneer Planner",
    },
    publisher: "aurona",
    version: "0.1.0",
    description: "Workplace planner and task tracker with Tabler icons and local persistence",
    displayDescription: {
      "zh-CN": "独立运行的任务管理看板，集成官方原生 Select 组件",
      "zh-Hant": "獨立運行的任務管理看板，集成官方原生 Select 組件",
      en: "Workplace planner and task tracker with native Select component",
    },
    sidebarTitle: "Planner",
    displayTitle: {
      "zh-CN": "先锋计划看板",
      "zh-Hant": "先鋒計畫看板",
      en: "Pioneer Planner",
    },
    sidebarIcon: "assets/icon.svg",
    viewEntry: "ui/index.html",
  },
  {
    id: "aurona.vscode-compat",
    name: "VSCode Extension Runtime",
    displayName: {
      "zh-CN": "VSCode 兼容转译层",
      "zh-Hant": "VSCode 相容轉譯層",
      en: "VSCode Compat",
    },
    publisher: "aurona",
    version: "0.1.0",
    description: "Shared WASM translation and execution runtime for VSCode extensions",
    displayDescription: {
      "zh-CN": "Aurona Code 的 VSCode 扩展共用底层 WASM 转译与安全沙箱容器",
      "zh-Hant": "Aurona Code 的 VSCode 擴充共用底層 WASM 轉譯與安全沙箱容器",
      en: "Shared WASM translation and execution runtime for VSCode extensions",
    },
    sidebarTitle: "VSCode 兼容",
    displayTitle: {
      "zh-CN": "VSCode 兼容",
      "zh-Hant": "VSCode 相容",
      en: "VSCode Compat",
    },
    sidebarIcon: "assets/icon.svg",
    viewEntry: "ui/index.html",
  },
  {
    id: "vscode-demo",
    name: "VSCode Bridge Demo (.vsix)",
    displayName: {
      "zh-CN": "VSCode Demo 演示插件",
      "zh-Hant": "VSCode Demo 演示擴充",
      en: "VSCode Demo",
    },
    publisher: "Aurona Labs",
    version: "1.0.0",
    description:
      "Official VSCode .vsix demonstration package executed natively by Aurona WASM Sandbox",
    displayDescription: {
      "zh-CN": "官方标准 VSCode .vsix 格式插件演示包，由底层兼容层原生转译执行",
      "zh-Hant": "官方標準 VSCode .vsix 格式擴充演示包，由底層相容層原生轉譯執行",
      en: "Official VSCode .vsix demonstration package executed natively by Aurona WASM Sandbox",
    },
    sidebarTitle: "VSCode Demo",
    displayTitle: {
      "zh-CN": "VSCode Demo",
      "zh-Hant": "VSCode Demo",
      en: "VSCode Demo",
    },
    sidebarIcon: "assets/icon.svg",
    viewEntry: "ui/index.html",
  },
];

export const useExtensionStore = create<ExtensionStoreState>((set, get) => ({
  descriptors: BUILTIN_DESCRIPTORS,
  hiddenExtensionIds: loadHiddenExtensions(),
  views: {},
  permissions: {},
  initialized: false,

  async initialize() {
    if (get().initialized) return;
    await get().refresh();
  },

  async refresh() {
    try {
      const remoteDescriptors = await ExtensionIPC.list();
      const descriptors =
        Array.isArray(remoteDescriptors) && remoteDescriptors.length > 0
          ? remoteDescriptors
          : BUILTIN_DESCRIPTORS;
      set({
        descriptors,
        hiddenExtensionIds: loadHiddenExtensions(),
        initialized: true,
      });
      for (const descriptor of descriptors) {
        void ExtensionIPC.getView(descriptor.id)
          .then((view) => {
            set((state) => ({ views: { ...state.views, [descriptor.id]: view } }));
          })
          .catch(() => undefined);
      }
    } catch {
      set({ descriptors: BUILTIN_DESCRIPTORS, initialized: true });
    }
  },

  viewFor(extensionId) {
    const cached = get().views[extensionId];
    if (cached) return Promise.resolve(cached);
    return ExtensionIPC.getView(extensionId).then((view) => {
      set((state) => ({ views: { ...state.views, [extensionId]: view } }));
      return view;
    });
  },

  async permissionFor(extensionId, permission) {
    const state = await ExtensionIPC.getPermission(extensionId, permission);
    set((current) => ({
      permissions: {
        ...current.permissions,
        [permissionKey(extensionId, permission)]: state,
      },
    }));
    return state;
  },

  async setPermission(extensionId, permission, granted) {
    const state = await ExtensionIPC.setPermission(extensionId, permission, granted);
    set((current) => ({
      permissions: {
        ...current.permissions,
        [permissionKey(extensionId, permission)]: state,
      },
    }));
    return state;
  },

  hideExtension(extensionId) {
    set((state) => {
      if (state.hiddenExtensionIds.includes(extensionId)) return state;
      const next = [...state.hiddenExtensionIds, extensionId];
      saveHiddenExtensions(next);
      return { hiddenExtensionIds: next };
    });
  },

  restoreExtension(extensionId) {
    set((state) => {
      const next = state.hiddenExtensionIds.filter((id) => id !== extensionId);
      saveHiddenExtensions(next);
      return { hiddenExtensionIds: next };
    });
  },
}));
