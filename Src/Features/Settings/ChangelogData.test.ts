import { describe, expect, it } from "vitest";
import { CHANGELOG_DATA } from "./ChangelogData";

describe("changelog release state", () => {
  it("marks the current published version as the only latest release", () => {
    const latest = CHANGELOG_DATA.filter((entry) => entry.isLatest);
    expect(latest).toHaveLength(1);
    expect(latest[0].version).toBe(`V${import.meta.env.VITE_APP_VERSION}`);
    expect(latest[0].isUnreleased).not.toBe(true);
    expect(latest[0].date).toBe("2026-11-08");
    expect(latest[0].sections).toHaveLength(4);
    expect(CHANGELOG_DATA).toHaveLength(1);
    expect(latest[0].summary?.split("\n")[0]).toBe("当前版本为Aurona Code全新升级的过渡版本");
  });

  it("keeps unique versions, readable sections and valid dates for published entries", () => {
    expect(new Set(CHANGELOG_DATA.map((entry) => entry.version)).size).toBe(CHANGELOG_DATA.length);
    for (const entry of CHANGELOG_DATA) {
      expect(entry.sections.length, entry.version).toBeGreaterThan(0);
      if (entry.isUnreleased) expect(entry.isLatest).not.toBe(true);
      else expect(entry.date, entry.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
