import { describe, expect, it } from "vitest";
import { localServerItem } from "./MarketplaceView";

describe("local toolchain marketplace items", () => {
  it("exposes local facts without market statistics", () => {
    const item = localServerItem(
      {
        id: "auronalabs.lsp-typescript",
        name: "TypeScript Language Server",
        version: "5.6.3",
        languages: ["typescript", "javascript"],
        runtimeType: "node",
        installPath: "C:\\Aurona\\toolchains\\typescript",
        diskSizeBytes: 1024 * 1024 * 12,
      },
      [
        {
          runtimeType: "node",
          version: "22.22.0",
          binaryPath: "C:\\Aurona\\runtimes\\node\\node.exe",
          diskSizeBytes: 1024 * 1024 * 88,
        },
      ],
    );

    expect(item).toMatchObject({
      id: "auronalabs.lsp-typescript",
      version: "5.6.3",
      fileSize: "12.0 MB",
      localToolchain: {
        installPath: "C:\\Aurona\\toolchains\\typescript",
      },
      runtimeMetadata: {
        runtimeType: "node",
        runtimeVersion: "22.22.0",
        fileSize: "88.0 MB",
      },
    });
    expect(item.downloads).toBeUndefined();
    expect(item.rating).toBeUndefined();
    expect(item.reviewCount).toBeUndefined();
  });
});
