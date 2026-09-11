import { create } from "zustand";
import { canonicalExtensionId, migrateExtensionRecords } from "../Features/Extensions/ExtensionId";
import {
  type ExtensionDescriptor,
  ExtensionIPC,
  type ExtensionPermissionState,
  type ExtensionViewPayload,
} from "../Foundation/IPC/ExtensionCommands";

const HIDDEN_EXTENSIONS_STORAGE_KEY = "aurona:hidden-extensions";
export const VSCODE_COMPAT_EXTENSION_ID = "aurona.vscode-compat";

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
    if (!Array.isArray(parsed)) return [];
    const ids = [
      ...new Set(
        parsed.filter((id): id is string => typeof id === "string").map(canonicalExtensionId),
      ),
    ];
    if (JSON.stringify(ids) !== JSON.stringify(parsed)) saveHiddenExtensions(ids);
    return ids;
  } catch {
    return [];
  }
}

function saveHiddenExtensions(ids: string[]): void {
  try {
    localStorage.setItem(HIDDEN_EXTENSIONS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Ignore storage failures.
  }
}

// Markdown and Planner are Marketplace packages, not bundled extensions.
export const BUILTIN_DESCRIPTORS: ExtensionDescriptor[] = [
  {
    id: "aurona.vscode-compat",
    name: "VSCode Extension Runtime",
    displayName: {
      "zh-CN": "VSCode 兼容运行时",
      "zh-Hant": "VSCode 兼容執行階段",
      en: "VSCode Compat",
    },
    publisher: "aurona",
    version: "0.1.0",
    description: "Shared WASM translation and execution runtime for VSCode extensions",
    displayDescription: {
      "zh-CN": "VSCode 扩展的共享 WASM 转译与安全沙箱运行时",
      en: "Shared WASM translation and execution runtime for VSCode extensions",
    },
    sidebarTitle: "VSCode 兼容",
    displayTitle: { "zh-CN": "VSCode 兼容", "zh-Hant": "VSCode 兼容", en: "VSCode Compat" },
    sidebarIcon: "assets/icon.svg",
    viewEntry: "ui/index.html",
  },
  {
    id: "vscode-demo",
    name: "VSCode Bridge Demo (.vsix)",
    displayName: {
      "zh-CN": "VSCode Demo 示例扩展",
      "zh-Hant": "VSCode Demo 示範擴充",
      en: "VSCode Demo",
    },
    publisher: "Aurona Labs",
    version: "1.0.0",
    description:
      "Official VSCode .vsix demonstration package executed natively by Aurona WASM Sandbox",
    displayDescription: {
      "zh-CN": "官方 VSCode .vsix 格式演示包，由底层兼容层原生转译执行",
      en: "Official VSCode .vsix demonstration package executed natively by Aurona WASM Sandbox",
    },
    sidebarTitle: "VSCode Demo",
    displayTitle: { "zh-CN": "VSCode Demo", "zh-Hant": "VSCode Demo", en: "VSCode Demo" },
    sidebarIcon: "assets/icon.svg",
    viewEntry: "ui/index.html",
  },
];

export const useExtensionStore = create<ExtensionStoreState>((set, get) => ({
  descriptors: [],
  hiddenExtensionIds: loadHiddenExtensions(),
  views: {},
  permissions: {},
  initialized: false,
  async initialize() {
    if (!get().initialized) await get().refresh();
  },
  async refresh() {
    try {
      const remoteDescriptors = await ExtensionIPC.list();
      // The compatibility layer is a built-in engine, not a user-facing extension.
      // Keep its package in the Rust registry so VSIX execution can use it, but do
      // not expose it as an installable/sidebar descriptor.
      const descriptors = Array.isArray(remoteDescriptors)
        ? migrateExtensionRecords(remoteDescriptors)
            .filter((descriptor) => descriptor.id !== VSCODE_COMPAT_EXTENSION_ID)
            .map((descriptor) => ({ ...descriptor, id: canonicalExtensionId(descriptor.id) }))
        : [];
      const hiddenExtensionIds = loadHiddenExtensions();
      saveHiddenExtensions(hiddenExtensionIds);
      set({ descriptors, hiddenExtensionIds, initialized: true });
      for (const descriptor of descriptors) {
        void ExtensionIPC.getView(descriptor.id)
          .then((view) => set((state) => ({ views: { ...state.views, [descriptor.id]: view } })))
          .catch(() => undefined);
      }
    } catch {
      set({ descriptors: [], initialized: true });
    }
  },
  viewFor(extensionId) {
    extensionId = canonicalExtensionId(extensionId);
    const cached = get().views[extensionId];
    if (cached) return Promise.resolve(cached);
    return ExtensionIPC.getView(extensionId).then((view) => {
      set((state) => ({ views: { ...state.views, [extensionId]: view } }));
      return view;
    });
  },
  async permissionFor(extensionId, permission) {
    extensionId = canonicalExtensionId(extensionId);
    const state = await ExtensionIPC.getPermission(extensionId, permission);
    set((current) => ({
      permissions: { ...current.permissions, [permissionKey(extensionId, permission)]: state },
    }));
    return state;
  },
  async setPermission(extensionId, permission, granted) {
    extensionId = canonicalExtensionId(extensionId);
    const state = await ExtensionIPC.setPermission(extensionId, permission, granted);
    set((current) => ({
      permissions: { ...current.permissions, [permissionKey(extensionId, permission)]: state },
    }));
    return state;
  },
  hideExtension(extensionId) {
    extensionId = canonicalExtensionId(extensionId);
    set((state) => {
      if (state.hiddenExtensionIds.includes(extensionId)) return state;
      const next = [...state.hiddenExtensionIds, extensionId];
      saveHiddenExtensions(next);
      return { hiddenExtensionIds: next };
    });
  },
  restoreExtension(extensionId) {
    extensionId = canonicalExtensionId(extensionId);
    set((state) => {
      const next = state.hiddenExtensionIds.filter((id) => id !== extensionId);
      saveHiddenExtensions(next);
      return { hiddenExtensionIds: next };
    });
  },
}));
