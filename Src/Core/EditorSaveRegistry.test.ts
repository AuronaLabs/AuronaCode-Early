import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), flush: vi.fn(), save: vi.fn() }));
vi.mock("./Documents", () => ({ DocumentService: mocks }));

import { EditorSaveRegistry } from "./EditorSaveRegistry";

describe("editor save fallback", () => {
  it("rechecks dirty state after pending edits have been acknowledged", async () => {
    let dirty = false;
    mocks.get.mockImplementation(() => ({ openState: "open", isDirty: dirty }));
    mocks.flush.mockImplementation(async () => {
      dirty = true;
    });
    mocks.save.mockImplementation(async () => {
      dirty = false;
    });
    await expect(EditorSaveRegistry.save("pending.ts")).resolves.toBe(true);
    expect(mocks.save).toHaveBeenCalledWith("pending.ts");
  });
});
