import { describe, expect, it } from "vitest";
import { CHANGELOG_DATA } from "./ChangelogData";

describe("changelog release state", () => {
  it("marks the current published version as the only latest release", () => {
    const latest = CHANGELOG_DATA.filter((entry) => entry.isLatest);
    expect(latest).toHaveLength(1);
    expect(latest[0].version).toBe(`V${import.meta.env.VITE_APP_VERSION}`);
    expect(latest[0].isUnreleased).not.toBe(true);
    expect(latest[0].date).toBe("2026-11-07");
    expect(latest[0].sections).toHaveLength(8);
    expect(CHANGELOG_DATA.find((entry) => entry.version === "V0.4.17")?.isLatest).toBe(false);
  });

  it("keeps unique versions, paired sections and valid dates for published entries", () => {
    expect(new Set(CHANGELOG_DATA.map((entry) => entry.version)).size).toBe(CHANGELOG_DATA.length);
    for (const entry of CHANGELOG_DATA) {
      expect(entry.sections.length % 2, entry.version).toBe(0);
      expect(entry.sections.length, entry.version).toBeGreaterThan(0);
      if (entry.isUnreleased) expect(entry.isLatest).not.toBe(true);
      else expect(entry.date, entry.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
