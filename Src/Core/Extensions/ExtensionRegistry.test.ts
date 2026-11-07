import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  view: vi.fn(),
  permission: vi.fn(),
  revoke: vi.fn(),
  setPermission: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("../../Foundation/IPC/ExtensionCommands", () => ({
  ExtensionIPC: {
    list: mocks.list,
    getView: mocks.view,
    getPermission: mocks.permission,
    setPermission: mocks.setPermission,
    revokePermission: mocks.revoke,
    permissionCatalog: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../Workspace", () => ({
  WorkspaceService: {
    getCurrent: () => ({ id: "a" }),
    subscribe: mocks.subscribe,
  },
}));

import { ExtensionRegistry, startExtensionRegistry } from "./ExtensionRegistry";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("extension context ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.subscribe.mockImplementation(() => vi.fn());
    mocks.list.mockResolvedValue([]);
    mocks.view.mockResolvedValue({ html: "new" });
    ExtensionRegistry.setState({
      initialized: false,
      descriptors: [],
      views: {},
      permissions: {},
      permissionScopes: {},
      lastError: null,
    });
  });
  it("restarts pending initialization for a new workspace and ignores the old list", async () => {
    const old = deferred<[]>();
    mocks.list.mockReturnValueOnce(old.promise);
    const stop = startExtensionRegistry();
    try {
      const initial = ExtensionRegistry.getState().initialize();
      mocks.subscribe.mock.calls[0][0]({ id: "b" });
      await vi.waitFor(() => expect(ExtensionRegistry.getState().initialized).toBe(true));
      expect(mocks.list).toHaveBeenCalledTimes(2);
      old.resolve([]);
      await initial;
      expect(ExtensionRegistry.getState().initialized).toBe(true);
    } finally {
      stop();
    }
  });
  it("deduplicates views and discards responses after the owning app stops", async () => {
    const old = deferred<{ html: string }>();
    mocks.view.mockReturnValueOnce(old.promise);
    const stop = startExtensionRegistry();
    const first = ExtensionRegistry.getState().viewFor("sample.demo");
    const second = ExtensionRegistry.getState().viewFor("sample.demo");
    expect(first).toBe(second);
    stop();
    old.resolve({ html: "old" });
    await expect(first).resolves.toBeUndefined();
    expect(ExtensionRegistry.getState().views).toEqual({});
  });
  it("does not overwrite a newer permission change with an old read", async () => {
    const old = deferred<{ state: string; scope: string }>();
    mocks.permission.mockReturnValueOnce(old.promise);
    mocks.setPermission.mockResolvedValue("denied");
    const read = ExtensionRegistry.getState().permissionFor("sample.demo", "fs.read");
    await ExtensionRegistry.getState().setPermission("sample.demo", "fs.read", false);
    old.resolve({ state: "granted", scope: "workspace" });
    await read;
    expect(ExtensionRegistry.getState().permissions["sample.demo:fs.read"]).toBe("denied");
  });
  it("keeps one subscription for all owners over 20 complete lifecycles", () => {
    for (let cycle = 0; cycle < 20; cycle++) {
      const first = startExtensionRegistry();
      const second = startExtensionRegistry();
      first();
      first();
      second();
      second();
    }
    expect(mocks.subscribe).toHaveBeenCalledTimes(20);
    for (const result of mocks.subscribe.mock.results) expect(result.value).toHaveBeenCalledOnce();
  });
  it("invalidates reads started while permission revocation is pending", async () => {
    const revoked = deferred<void>();
    const detail = deferred<{ state: string; scope: string }>();
    mocks.revoke.mockReturnValueOnce(revoked.promise);
    mocks.permission.mockReturnValueOnce(detail.promise);
    const revoke = ExtensionRegistry.getState().revokeAllPermissions("sample.demo");
    const read = ExtensionRegistry.getState().permissionFor("sample.demo", "fs.read");
    revoked.resolve();
    await revoke;
    detail.resolve({ state: "granted", scope: "workspace" });
    await read;
    expect(ExtensionRegistry.getState().permissions["sample.demo:fs.read"]).toBeUndefined();
  });
  it("preserves the last usable catalog when refresh fails", async () => {
    const previous = [
      {
        id: "sample.demo",
        name: "Demo",
        publisher: "sample",
        version: "1.0.0",
        sidebarTitle: "Demo",
        sidebarIcon: "",
        viewEntry: "index.html",
        permissions: [],
      },
    ];
    ExtensionRegistry.setState({ descriptors: previous });
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    await ExtensionRegistry.getState().refresh();
    expect(ExtensionRegistry.getState().descriptors).toBe(previous);
    expect(ExtensionRegistry.getState().lastError).toContain("offline");
  });
});
