import { createStore } from "zustand/vanilla";
import {
  type ExtensionDescriptor,
  ExtensionIPC,
  type ExtensionPermissionCatalogEntry,
  type ExtensionPermissionScope,
  type ExtensionPermissionState,
  type ExtensionViewPayload,
} from "../../Foundation/IPC/ExtensionCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { canonicalExtensionId, migrateExtensionRecords } from "../../Foundation/Types/ExtensionId";
import { WorkspaceService } from "../Workspace";

export {
  resolveExtensionDescription,
  resolveExtensionName,
  resolveExtensionSidebarTitle,
} from "./ExtensionUtils";

const HIDDEN_EXTENSIONS_STORAGE_KEY = "aurona:hidden-extensions";
export const VSCODE_COMPAT_EXTENSION_ID = "aurona.vscode-compat";

export interface ExtensionStoreState {
  lastError: string | null;
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

/** 规范化 id 列表（去重 + canonical），供快照与 UserConfig 双写共用 */
function normalizeHiddenIds(raw: unknown[]): string[] {
  return [
    ...new Set(raw.filter((id): id is string => typeof id === "string").map(canonicalExtensionId)),
  ];
}

function saveHiddenExtensions(ids: string[]): void {
  try {
    localStorage.setItem(HIDDEN_EXTENSIONS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Ignore storage failures.
  }
  // 真源写入 UserConfig（异步落盘）；localStorage 仅为下次启动的同步快照
  void UserConfigStore.set({ hiddenExtensionIds: ids }).catch((error) => {
    ExtensionRegistry.setState({ lastError: String(error) });
  });
}

let generation = 0;
let initialization: Promise<void> | null = null;
const viewRequests = new Map<string, Promise<ExtensionViewPayload | undefined>>();
const permissionRevisions = new Map<string, number>();
const nextPermissionRevision = (key: string) => {
  const next = (permissionRevisions.get(key) ?? 0) + 1;
  permissionRevisions.set(key, next);
  return next;
};

export const ExtensionRegistry = createStore<ExtensionStoreState>((set, get) => ({
  descriptors: [],
  hiddenExtensionIds: loadHiddenExtensions(),
  views: {},
  permissions: {},
  permissionScopes: {},
  permissionCatalog: [],
  initialized: false,
  lastError: null,
  async initialize() {
    if (get().initialized) return;
    if (!initialization) {
      const request = get()
        .refresh()
        .finally(() => {
          if (initialization === request) initialization = null;
        });
      initialization = request;
    }
    await initialization;
  },
  async refresh() {
    const epoch = ++generation;
    viewRequests.clear();
    try {
      const remoteDescriptors = await ExtensionIPC.list();
      if (generation !== epoch) return;
      // The compatibility layer is a built-in engine, not a user-facing extension.
      // Keep its package in the Rust registry so VSIX execution can use it, but do
      // not expose it as an installable/sidebar descriptor.
      const descriptors = Array.isArray(remoteDescriptors)
        ? migrateExtensionRecords(remoteDescriptors)
            .filter((descriptor) => descriptor.id !== VSCODE_COMPAT_EXTENSION_ID)
            .map((descriptor) => ({ ...descriptor, id: canonicalExtensionId(descriptor.id) }))
        : [];
      let hiddenExtensionIds = loadHiddenExtensions();
      try {
        const config = await UserConfigStore.get();
        if (Array.isArray(config.hiddenExtensionIds)) {
          const fromConfig = normalizeHiddenIds(config.hiddenExtensionIds);
          if (JSON.stringify(fromConfig) !== JSON.stringify(hiddenExtensionIds)) {
            hiddenExtensionIds = fromConfig;
            saveHiddenExtensions(fromConfig);
          }
        }
      } catch {
        // UserConfig 不可用时维持 localStorage 快照
      }
      if (generation !== epoch) return;
      set({
        descriptors,
        hiddenExtensionIds,
        views: {},
        permissions: {},
        permissionScopes: {},
        initialized: true,
        lastError: null,
      });
      // 权限目录：前端不维护自己的权限表，一律以后端为准
      void ExtensionIPC.permissionCatalog()
        .then((permissionCatalog) => {
          if (generation === epoch) set({ permissionCatalog });
        })
        .catch(() => undefined);
      for (const descriptor of descriptors)
        void get()
          .viewFor(descriptor.id)
          .catch(() => undefined);
    } catch (error) {
      // A failed refresh must not erase the last usable extension list.
      if (generation === epoch) set({ initialized: true, lastError: String(error) });
    }
  },
  viewFor(extensionId) {
    extensionId = canonicalExtensionId(extensionId);
    const cached = get().views[extensionId];
    if (cached) return Promise.resolve(cached);
    const key = `${generation}:${extensionId}`;
    const existing = viewRequests.get(key);
    if (existing) return existing;
    const epoch = generation;
    const request = ExtensionIPC.getView(extensionId)
      .then((view) => {
        if (generation !== epoch) return undefined;
        set((state) => ({ views: { ...state.views, [extensionId]: view } }));
        return view;
      })
      .finally(() => {
        viewRequests.delete(key);
      });
    viewRequests.set(key, request);
    return request;
  },
  async permissionFor(extensionId, permission) {
    extensionId = canonicalExtensionId(extensionId);
    const key = permissionKey(extensionId, permission);
    const revision = nextPermissionRevision(key);
    const epoch = generation;
    const detail = await ExtensionIPC.getPermission(extensionId, permission);
    if (epoch !== generation || permissionRevisions.get(key) !== revision) return "unknown";
    set((current) => ({
      permissions: { ...current.permissions, [key]: detail.state },
      permissionScopes: { ...current.permissionScopes, [key]: detail.scope },
    }));
    return detail.state;
  },
  async setPermission(extensionId, permission, granted, scope = "workspace") {
    extensionId = canonicalExtensionId(extensionId);
    const key = permissionKey(extensionId, permission);
    const revision = nextPermissionRevision(key);
    const epoch = generation;
    const state = await ExtensionIPC.setPermission(extensionId, permission, granted, scope);
    if (epoch !== generation || permissionRevisions.get(key) !== revision) return state;
    set((current) => ({
      permissions: { ...current.permissions, [key]: state },
      permissionScopes: { ...current.permissionScopes, [key]: scope },
    }));
    return state;
  },
  async revokeAllPermissions(extensionId) {
    extensionId = canonicalExtensionId(extensionId);
    for (const key of permissionRevisions.keys())
      if (key.startsWith(`${extensionId}:`)) nextPermissionRevision(key);
    const epoch = generation;
    await ExtensionIPC.revokePermission(extensionId);
    if (epoch !== generation) return;
    // A read started while revocation was pending may still contain the old grant.
    for (const key of permissionRevisions.keys())
      if (key.startsWith(`${extensionId}:`)) nextPermissionRevision(key);
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

/** Workspace changes invalidate permission/view responses; descriptor refresh remains demand-driven. */
let owners = 0;
let unsubscribeWorkspace: (() => void) | null = null;

function invalidateContext(): void {
  generation++;
  initialization = null;
  viewRequests.clear();
  permissionRevisions.clear();
  ExtensionRegistry.setState({
    views: {},
    permissions: {},
    permissionScopes: {},
    initialized: false,
  });
}

export function startExtensionRegistry(): () => void {
  owners++;
  if (owners === 1) {
    let id = WorkspaceService.getCurrent().id;
    unsubscribeWorkspace = WorkspaceService.subscribe((workspace) => {
      if (workspace.id === id) return;
      id = workspace.id;
      const wasRequested = ExtensionRegistry.getState().initialized || initialization !== null;
      invalidateContext();
      if (wasRequested) void ExtensionRegistry.getState().initialize();
    });
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (--owners === 0) {
      unsubscribeWorkspace?.();
      unsubscribeWorkspace = null;
      invalidateContext();
    }
  };
}
