import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, getViewMock, getPermissionMock, setPermissionMock, renderMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    getViewMock: vi.fn(),
    getPermissionMock: vi.fn(),
    setPermissionMock: vi.fn(),
    renderMock: vi.fn(),
  }),
);

vi.mock("../Foundation/IPC/ExtensionCommands", () => ({
  ExtensionIPC: {
    list: listMock,
    getView: getViewMock,
    getPermission: getPermissionMock,
    setPermission: setPermissionMock,
    render: renderMock,
  },
}));

import { useExtensionStore } from "./useExtensionStore";

const descriptor = {
  id: "auronalabs.markdown",
  name: "Markdown Preview",
  publisher: "aurona",
  version: "0.1.0",
  sidebarTitle: "Markdown",
  sidebarIcon: "assets/icon.svg",
  viewEntry: "ui/index.html",
};

describe("useExtensionStore", () => {
  beforeEach(() => {
    useExtensionStore.setState({
      descriptors: [],
      views: {},
      permissions: {},
      initialized: false,
    });
    vi.clearAllMocks();
  });

  it("initializes descriptors and prefetches views", async () => {
    listMock.mockResolvedValue([descriptor]);
    getViewMock.mockResolvedValue({ html: "<html></html>", icon: "<svg></svg>" });

    await useExtensionStore.getState().initialize();
    await vi.waitFor(() => {
      expect(useExtensionStore.getState().views["auronalabs.markdown"]).toBeDefined();
    });
    expect(useExtensionStore.getState().descriptors).toEqual([descriptor]);
    expect(listMock).toHaveBeenCalledOnce();
  });

  it("caches views per extension", async () => {
    getViewMock.mockResolvedValue({ html: "<html></html>", icon: "<svg></svg>" });
    const first = await useExtensionStore.getState().viewFor("auronalabs.markdown");
    const second = await useExtensionStore.getState().viewFor("auronalabs.markdown");
    expect(first).toEqual(second);
    expect(getViewMock).toHaveBeenCalledOnce();
  });

  it("stores and returns permission state", async () => {
    getPermissionMock.mockResolvedValue("unknown");
    setPermissionMock.mockResolvedValue("granted");

    expect(
      await useExtensionStore
        .getState()
        .permissionFor("auronalabs.markdown", "editor.current.read"),
    ).toBe("unknown");
    expect(
      await useExtensionStore
        .getState()
        .setPermission("auronalabs.markdown", "editor.current.read", true),
    ).toBe("granted");
    expect(setPermissionMock).toHaveBeenCalledWith(
      "auronalabs.markdown",
      "editor.current.read",
      true,
    );
  });

  it("hides and restores extensions", () => {
    useExtensionStore.setState({ hiddenExtensionIds: [] });
    useExtensionStore.getState().hideExtension("auronalabs.markdown");
    expect(useExtensionStore.getState().hiddenExtensionIds).toContain("auronalabs.markdown");

    useExtensionStore.getState().restoreExtension("auronalabs.markdown");
    expect(useExtensionStore.getState().hiddenExtensionIds).not.toContain("auronalabs.markdown");
  });

  it("does not re-initialize once initialized", async () => {
    listMock.mockResolvedValue([descriptor]);
    await useExtensionStore.getState().initialize();
    await useExtensionStore.getState().initialize();
    expect(listMock).toHaveBeenCalledOnce();
  });
});
