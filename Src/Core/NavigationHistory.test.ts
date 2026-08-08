import { beforeEach, describe, expect, it } from "vitest";
import { NavigationHistory } from "./NavigationHistory";

describe("NavigationHistory", () => {
  beforeEach(() => {
    NavigationHistory.clear();
  });

  it("records entries and moves back and forward", () => {
    NavigationHistory.record({ path: "C:/a.ts", line: 1 });
    NavigationHistory.record({ path: "C:/b.ts", line: 10 });
    NavigationHistory.record({ path: "C:/c.ts", line: 20 });

    expect(NavigationHistory.getSnapshot().canGoBack).toBe(true);
    expect(NavigationHistory.getSnapshot().canGoForward).toBe(false);

    expect(NavigationHistory.goBack()).toEqual({ path: "C:/b.ts", line: 10 });
    expect(NavigationHistory.goBack()).toEqual({ path: "C:/a.ts", line: 1 });
    expect(NavigationHistory.goBack()).toBeNull();

    expect(NavigationHistory.goForward()).toEqual({ path: "C:/b.ts", line: 10 });
    expect(NavigationHistory.goForward()).toEqual({ path: "C:/c.ts", line: 20 });
    expect(NavigationHistory.goForward()).toBeNull();
  });

  it("deduplicates consecutive identical positions", () => {
    NavigationHistory.record({ path: "C:/a.ts", line: 5 });
    NavigationHistory.record({ path: "C:/a.ts", line: 5 });
    expect(NavigationHistory.getSnapshot().entries).toHaveLength(1);
  });

  it("truncates forward history when a new entry is recorded", () => {
    NavigationHistory.record({ path: "C:/a.ts", line: 1 });
    NavigationHistory.record({ path: "C:/b.ts", line: 2 });
    NavigationHistory.record({ path: "C:/c.ts", line: 3 });
    NavigationHistory.goBack();
    NavigationHistory.record({ path: "C:/d.ts", line: 4 });
    expect(NavigationHistory.getSnapshot().entries.map((entry) => entry.path)).toEqual([
      "C:/a.ts",
      "C:/b.ts",
      "C:/d.ts",
    ]);
    expect(NavigationHistory.goForward()).toBeNull();
  });

  it("caps the history size", () => {
    for (let index = 0; index < 120; index += 1) {
      NavigationHistory.record({ path: `C:/f${index}.ts`, line: index });
    }
    expect(NavigationHistory.getSnapshot().entries).toHaveLength(100);
    expect(NavigationHistory.getSnapshot().entries[0]?.path).toBe("C:/f20.ts");
  });
});
