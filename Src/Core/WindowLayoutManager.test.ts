import { describe, expect, it } from "vitest";
import { computeRestoredRect } from "./WindowLayoutManager";

const SCREEN_1920 = { x: 0, y: 0, width: 1920, height: 1040 };

describe("computeRestoredRect", () => {
  it("passes a normal in-bounds rect through unchanged", () => {
    const rect = computeRestoredRect({ width: 1280, height: 800, x: 100, y: 80 }, [SCREEN_1920]);
    expect(rect).toEqual({ width: 1280, height: 800, x: 100, y: 80 });
  });

  it("raises undersized windows to the 800×600 minimum", () => {
    const rect = computeRestoredRect({ width: 400, height: 300, x: 10, y: 10 }, [SCREEN_1920]);
    expect(rect?.width).toBe(800);
    expect(rect?.height).toBe(600);
  });

  it("clamps oversized windows to the largest monitor size", () => {
    const rect = computeRestoredRect({ width: 5000, height: 4000, x: 0, y: 0 }, [SCREEN_1920]);
    expect(rect?.width).toBe(1920);
    expect(rect?.height).toBe(1040);
  });

  it("pulls a lost window back so at least the visible margin stays on screen", () => {
    // 窗口被保存到 x=5000（拔掉的右侧显示器），必须拉回可见余量内
    const rect = computeRestoredRect({ width: 1280, height: 800, x: 5000, y: 5000 }, [SCREEN_1920]);
    expect(rect?.x).toBe(1920 - 120);
    expect(rect?.y).toBe(1040 - 120);
  });

  it("supports monitors left of / above the origin via the areas union", () => {
    const left = { x: -1920, y: -200, width: 1920, height: 1040 };
    const rect = computeRestoredRect({ width: 1280, height: 800, x: -1900, y: -190 }, [
      left,
      SCREEN_1920,
    ]);
    expect(rect?.x).toBe(-1900);
    expect(rect?.y).toBe(-190);
  });

  it("keeps undefined positions undefined (no forced reposition)", () => {
    const rect = computeRestoredRect({ width: 1280, height: 800 }, [SCREEN_1920]);
    expect(rect?.x).toBeUndefined();
    expect(rect?.y).toBeUndefined();
  });

  it("returns null without monitor areas (caller falls back to maximize)", () => {
    expect(computeRestoredRect({ width: 1280, height: 800, x: 0, y: 0 }, [])).toBeNull();
  });

  it("returns null for zero-sized saved state", () => {
    expect(computeRestoredRect({ width: 0, height: 0, x: 0, y: 0 }, [SCREEN_1920])).toBeNull();
  });
});
