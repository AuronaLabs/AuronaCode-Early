import { create } from "zustand";
import { canonicalExtensionId, migrateExtensionRecords } from "../Features/Extensions/ExtensionId";
import {
  type ExtensionDescriptor,
  ExtensionIPC,
  type ExtensionPermissionCatalogEntry,
  type ExtensionPermissionScope,
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
  /** 当前生效授权的作用域（"global"/"workspace"/"once"/"unknown"），与 permissions 同 key */
  permissionScopes: Record<string, string | undefined>;
  /** 后端权限目录（单一真相源），启动时拉取 */
  permissionCatalog: ExtensionPermissionCatalogEntry[];
  initialized: boolean;
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  viewFor(extensionId: string): Promise<ExtensionViewPayload | undefined>;
  permissionFor(extensionId: string, permission: string): Promise<ExtensionPermissionState>;
  setPermission(
    extensionId: string,
    permission: string,
    granted: boolean,
    scope?: ExtensionPermissionScope,
  ): Promise<ExtensionPermissionState>;
  /** 撤销某扩展的全部已授权限（恢复 unknown，下次使用重新询问） */
  revokeAllPermissions(extensionId: string): Promise<void>;
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

export const useExtensionStore = create<ExtensionStoreState>((set, get) => ({
  descriptors: [],
  hiddenExtensionIds: loadHiddenExtensions(),
  views: {},
  permissions: {},
  permissionScopes: {},
  permissionCatalog: [],
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
      // 权限目录：前端不维护自己的权限表，一律以后端为准
      void ExtensionIPC.permissionCatalog()
        .then((permissionCatalog) => set({ permissionCatalog }))
        .catch(() => undefined);
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
    const detail = await ExtensionIPC.getPermission(extensionId, permission);
    const key = permissionKey(extensionId, permission);
    set((current) => ({
      permissions: { ...current.permissions, [key]: detail.state },
      permissionScopes: { ...current.permissionScopes, [key]: detail.scope },
    }));
    return detail.state;
  },
  async setPermission(extensionId, permission, granted, scope = "workspace") {
    extensionId = canonicalExtensionId(extensionId);
    const state = await ExtensionIPC.setPermission(extensionId, permission, granted, scope);
    const key = permissionKey(extensionId, permission);
    set((current) => ({
      permissions: { ...current.permissions, [key]: state },
      permissionScopes: { ...current.permissionScopes, [key]: scope },
    }));
    return state;
  },
  async revokeAllPermissions(extensionId) {
    extensionId = canonicalExtensionId(extensionId);
    await ExtensionIPC.revokePermission(extensionId);
    // 本地缓存一并失效
    set((current) => {
      const prefix = `${extensionId}:`;
      const nextPermissions: Record<string, ExtensionPermissionState | undefined> = {};
      const nextScopes: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(current.permissions)) {
        if (!key.startsWith(prefix)) nextPermissions[key] = value;
      }
      for (const [key, value] of Object.entries(current.permissionScopes)) {
        if (!key.startsWith(prefix)) nextScopes[key] = value;
      }
      return { permissions: nextPermissions, permissionScopes: nextScopes };
    });
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
