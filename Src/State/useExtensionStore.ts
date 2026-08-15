import { create } from "zustand";
import {
  type ExtensionDescriptor,
  ExtensionIPC,
  type ExtensionPermissionState,
  type ExtensionViewPayload,
} from "../Foundation/IPC/ExtensionCommands";

interface ExtensionStoreState {
  descriptors: ExtensionDescriptor[];
  views: Record<string, ExtensionViewPayload | undefined>;
  permissions: Record<string, ExtensionPermissionState | undefined>;
  initialized: boolean;
  initialize(): Promise<void>;
  viewFor(extensionId: string): Promise<ExtensionViewPayload | undefined>;
  permissionFor(extensionId: string, permission: string): Promise<ExtensionPermissionState>;
  setPermission(
    extensionId: string,
    permission: string,
    granted: boolean,
  ): Promise<ExtensionPermissionState>;
}

const permissionKey = (extensionId: string, permission: string) => `${extensionId}:${permission}`;

export const useExtensionStore = create<ExtensionStoreState>((set, get) => ({
  descriptors: [],
  views: {},
  permissions: {},
  initialized: false,

  async initialize() {
    if (get().initialized) return;
    try {
      const descriptors = await ExtensionIPC.list();
      set({ descriptors, initialized: true });
      for (const descriptor of descriptors) {
        void get()
          .viewFor(descriptor.id)
          .catch(() => undefined);
      }
    } catch {
      set({ descriptors: [], initialized: true });
    }
  },

  async viewFor(extensionId) {
    const cached = get().views[extensionId];
    if (cached) return cached;
    const view = await ExtensionIPC.getView(extensionId);
    set((state) => ({ views: { ...state.views, [extensionId]: view } }));
    return view;
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
}));
