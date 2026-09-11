import { describe, expect, it } from "vitest";
import {
  canonicalExtensionId,
  LEGACY_EXTENSION_ID_ALIASES,
  migrateExtensionRecords,
} from "./ExtensionId";

describe("extension id migration", () => {
  it("maps every legacy id to its canonical id", () => {
    expect(canonicalExtensionId("aurona.markdown")).toBe("auronalabs.markdown");
    expect(canonicalExtensionId("aurona.planner")).toBe("auronalabs.planner");
    expect(Object.keys(LEGACY_EXTENSION_ID_ALIASES)).toHaveLength(2);
  });

  it("deduplicates legacy and canonical records with canonical precedence", () => {
    const records = migrateExtensionRecords([
      { id: "aurona.markdown", version: "0.1.0" },
      { id: "auronalabs.markdown", version: "0.1.2" },
      { id: "aurona.planner", version: "0.1.0" },
    ]);

    expect(records).toEqual([
      { id: "auronalabs.markdown", version: "0.1.2" },
      { id: "auronalabs.planner", version: "0.1.0" },
    ]);
  });
});
