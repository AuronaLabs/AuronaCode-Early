import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
}));

vi.mock("../Foundation/IPC/FileSystemCommands", () => ({
  FileSystemCommands: {
    readTextFile: mocks.readTextFile,
  },
}));

import { LocationResultsStore } from "./LocationResultsStore";

const location = (uri: string, line: number, start = 0, end = 3) => ({
  uri,
  range: {
    start: { line, character: start },
    end: { line, character: end },
  },
});

describe("LocationResultsStore", () => {
  beforeEach(() => {
    LocationResultsStore.clear();
    mocks.readTextFile.mockReset();
  });

  it("opens locations and loads trimmed previews with match ranges", async () => {
    mocks.readTextFile.mockImplementation((path: string) => {
      const normalized = path.replace(/\\/g, "/");
      if (normalized === "C:/repo/a.ts") {
        return Promise.resolve("const alpha = 1;\nconst beta = 2;\n");
      }
      return Promise.resolve("");
    });
    await LocationResultsStore.open("references", "References", [
      location("file:///C:/repo/a.ts", 0, 6, 11),
      location("file:///C:/repo/a.ts", 1, 6, 10),
    ]);
    const state = LocationResultsStore.getSnapshot();
    expect(state?.items).toHaveLength(2);
    expect(state?.items[0]?.preview).toBe("const alpha = 1;");
    expect(state?.items[0]?.matchStart).toBe(6);
    expect(state?.items[0]?.matchEnd).toBe(11);
    expect(state?.items[1]?.preview).toBe("const beta = 2;");
    expect(state?.items[1]?.matchStart).toBe(6);
    expect(state?.items[1]?.matchEnd).toBe(10);
  });

  it("ignores previews from a stale request", async () => {
    let resolveFirst: ((value: string) => void) | undefined;
    mocks.readTextFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    mocks.readTextFile.mockResolvedValue("const fresh = 1;\n");

    const first = LocationResultsStore.open("definition", "Definitions", [
      location("file:///C:/repo/a.ts", 0),
    ]);
    await LocationResultsStore.open("definition", "Definitions", [
      location("file:///C:/repo/b.ts", 0, 6, 11),
    ]);
    resolveFirst?.("stale content\n");
    await first;

    const state = LocationResultsStore.getSnapshot();
    expect(state?.items[0]?.path).toBe("C:\\repo\\b.ts");
    expect(state?.items[0]?.preview).toBe("const fresh = 1;");
  });

  it("clears the state", async () => {
    mocks.readTextFile.mockResolvedValue("");
    await LocationResultsStore.open("references", "References", [
      location("file:///C:/repo/a.ts", 0),
    ]);
    LocationResultsStore.clear();
    expect(LocationResultsStore.getSnapshot()).toBeNull();
  });
});
