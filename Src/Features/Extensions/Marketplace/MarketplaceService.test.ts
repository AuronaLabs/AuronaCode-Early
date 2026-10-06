import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfigMock, setConfigMock, fetchMock, desktopMock, requestMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  setConfigMock: vi.fn(),
  fetchMock: vi.fn(),
  desktopMock: vi.fn(() => false),
  requestMock: vi.fn(),
}));

vi.mock("../../../Foundation/Desktop", () => ({ desktopAvailable: desktopMock }));
vi.mock("../../../Foundation/IPC/NetworkCommands", () => ({
  NetworkIPC: {
    marketplaceRequest: requestMock,
    cancelMarketplaceRequest: vi.fn(),
    cachedCatalog: vi.fn(),
  },
}));

vi.mock("../../../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: { get: getConfigMock, set: setConfigMock },
}));

vi.mock("../../../Foundation/IPC/AccountAuthCommands", () => ({
  AccountAuthIPC: {
    status: vi.fn().mockResolvedValue({
      phase: "signedOut",
      expiresAtUnix: null,
    }),
    refresh: vi.fn(),
    accessToken: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../../Foundation/IPC/ExtensionCommands", () => ({
  ExtensionIPC: {
    install: vi.fn(),
    uninstall: vi.fn(),
  },
}));

vi.mock("../../../Foundation/IPC/LanguageServerCommands", () => ({
  LanguageServerIPC: {
    listToolchains: vi.fn(),
    installToolchainFromUrl: vi.fn(),
    uninstallToolchain: vi.fn(),
    uninstallToolchainRuntime: vi.fn(),
    onDownloadProgress: vi.fn(),
  },
}));

import { AccountAuthIPC } from "../../../Foundation/IPC/AccountAuthCommands";
import {
  descriptorToMarketplaceItem,
  isAbortError,
  isOfficialMarketplaceHost,
  MarketplaceService,
} from "./MarketplaceService";

describe("MarketplaceService.fetchMarketplace", () => {
  it("does not give unsigned local descriptors verified identity or hide their permissions", () => {
    const item = descriptorToMarketplaceItem({
      id: "example.local",
      name: "Local",
      publisher: "example",
      version: "1.0.0",
      sidebarTitle: "Local",
      sidebarIcon: "",
      viewEntry: "view.html",
      permissions: ["fs.read"],
    });
    expect(item.verified).toBe(false);
    expect(item.rawPermissions).toEqual(["fs.read"]);
  });
  beforeEach(() => {
    desktopMock.mockReturnValue(false);
    requestMock.mockReset();
    getConfigMock.mockResolvedValue({});
    setConfigMock.mockResolvedValue(undefined);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
  });

  it("does not classify an explicitly aborted request as offline", async () => {
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The request was aborted", "AbortError"));
        });
      });
    });
    const controller = new AbortController();
    const request = MarketplaceService.fetchMarketplace(undefined, undefined, [], {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports a real network failure as server-unreachable offline", async () => {
    fetchMock.mockRejectedValue(new TypeError("network unavailable"));

    await expect(MarketplaceService.fetchMarketplace()).resolves.toMatchObject({
      items: [],
      source: "offline",
      offlineReason: "server-unreachable",
    });
  });

  it("displays verified identity only for a catalog verified by the native backend", async () => {
    desktopMock.mockReturnValue(true);
    const body = JSON.stringify({
      data: [
        {
          id: "fixture.extension",
          name: "Fixture",
          publisher: "fixture",
          version: "1.0.0",
          verified: true,
        },
      ],
    });
    requestMock.mockResolvedValue({ status: 200, body, catalog_verified: true });
    expect((await MarketplaceService.fetchMarketplace()).items[0].verified).toBe(true);
    requestMock.mockResolvedValue({ status: 200, body, catalog_verified: false });
    expect((await MarketplaceService.fetchMarketplace()).items[0].verified).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds official credentials to the HTTPS origin and skips token exchange for local servers", async () => {
    for (const url of [
      "http://marketplace.aurona.cc/api",
      "https://marketplace.aurona.cc:8443/api",
      "https://user:secret@marketplace.aurona.cc/api",
      "http://127.0.0.1:5219/api",
    ])
      expect(isOfficialMarketplaceHost(url)).toBe(false);
    expect(isOfficialMarketplaceHost("https://marketplace.aurona.cc/api")).toBe(true);
    getConfigMock.mockResolvedValue({ marketplaceServerUrl: "http://127.0.0.1:5219/api" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.mocked(AccountAuthIPC.accessToken).mockClear();
    await MarketplaceService.checkStarStatus("auronalabs.markdown");
    expect(AccountAuthIPC.accessToken).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("token-exchange"))).toBe(
      false,
    );
  });

  it("preserves signed pagination and refuses invalid page budgets", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [], pagination: { nextPage: 3 } }), { status: 200 }),
    );
    await expect(
      MarketplaceService.fetchMarketplace(undefined, undefined, [], { page: 2 }),
    ).resolves.toMatchObject({ nextPage: 3 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("page=2");
    await expect(
      MarketplaceService.fetchMarketplace(undefined, undefined, [], { page: 0 }),
    ).rejects.toThrow("pagination");
  });

  it("reports malformed successful responses as invalid-response offline", async () => {
    fetchMock.mockResolvedValue(
      new Response("not-json", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );

    await expect(MarketplaceService.fetchMarketplace()).resolves.toMatchObject({
      source: "offline",
      offlineReason: "invalid-response",
    });
  });

  it("normalizes payloads without inventing market statistics", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "aurona.markdown",
              name: "Markdown Preview",
              publisher: "Aurona Labs",
              version: "0.1.2",
              verified: true,
              description: "Preview Markdown",
              category: "Developer Tools",
              packageType: "aurx",
              fileSizeFormatted: "12 KB",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await MarketplaceService.fetchMarketplace();
    expect(result.source).toBe("online");
    expect(result.items[0]).toMatchObject({
      id: "auronalabs.markdown",
      fileSize: "12 KB",
    });
    expect(result.items[0].downloads).toBeUndefined();
    expect(result.items[0].rating).toBeUndefined();
    expect(result.items[0].reviewCount).toBeUndefined();
    expect(result.items[0].verified).toBe(false);
  });

  it("requests Runtime metadata from the manifest-backed endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            runtimeType: "node",
            version: "22.22.0",
            fileSizeFormatted: "88.2 MB",
            sha256: "abc123",
            downloadUrl: "/api/runtimes/node/download",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(MarketplaceService.fetchRuntimeMetadata("node")).resolves.toEqual({
      runtimeType: "node",
      runtimeVersion: "22.22.0",
      fileSize: "88.2 MB",
      sha256: "abc123",
      downloadUrl: "https://marketplace.aurona.cc/api/runtimes/node/download",
    });
  });

  it("migrates and deduplicates legacy ids in the offline catalog", async () => {
    localStorage.setItem(
      "aurona.marketplace.catalog.v1",
      JSON.stringify([
        { id: "aurona.markdown", name: "Legacy", version: "0.1.0" },
        { id: "auronalabs.markdown", name: "Canonical", version: "0.1.2" },
      ]),
    );
    fetchMock.mockRejectedValue(new TypeError("offline"));

    const result = await MarketplaceService.fetchMarketplace();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "auronalabs.markdown",
      name: "Canonical",
      version: "0.1.2",
    });
    expect(JSON.parse(localStorage.getItem("aurona.marketplace.catalog.v1") || "[]")).toHaveLength(
      1,
    );
  });
});
