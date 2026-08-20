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

export const useExtensionStore = create<ExtensionStoreState>((set, get) => ({
  descriptors: [],
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
      const descriptors = await ExtensionIPC.list();
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
      set({ descriptors: [], initialized: true });
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
