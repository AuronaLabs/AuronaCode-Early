import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfigMock, setConfigMock, fetchMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  setConfigMock: vi.fn(),
  fetchMock: vi.fn(),
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

import { isAbortError, MarketplaceService } from "./MarketplaceService";

describe("MarketplaceService.fetchMarketplace", () => {
  beforeEach(() => {
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
