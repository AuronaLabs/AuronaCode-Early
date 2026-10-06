import { describe, expect, it } from "vitest";
import { boundedCatalog, validateMarketplaceRecord } from "./MarketplaceSchema";

describe("Marketplace schema", () => {
  it("rejects values that would be silently coerced into display metadata", () => {
    for (const change of [
      { name: {} },
      { tags: [1] },
      { publisher: true },
      { version: "1" },
      { verified: "true" },
      { id: "../escape" },
      { downloads: Number.NaN },
      { displayName: { en: {} } },
      { displayName: "a".repeat(8193) },
      { version: "1.0.0-01" },
      { version: "1.0.0-a..b" },
      { publisher: { avatar: "a".repeat(8193) } },
      { permissions: [{ id: {} }] },
      { rawPermissions: [true] },
      { publishedVersions: [{ version: "invalid" }] },
      { lspMetadata: { languages: [1] } },
      { runtimeMetadata: { sha256: "not-a-hash" } },
    ])
      expect(() =>
        validateMarketplaceRecord({ id: "test.extension", version: "1.0.0", ...change }),
      ).toThrow();
    expect(() =>
      validateMarketplaceRecord({
        id: "aurona.vscode-compat",
        version: "0.4.14",
        publisher: { name: "Aurona", verified: true },
        tags: ["safe"],
      }),
    ).not.toThrow();
    expect(() => boundedCatalog(Array.from({ length: 1001 }, () => ({})))).toThrow();
  });
});
