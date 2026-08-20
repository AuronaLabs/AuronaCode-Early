import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMultiCursorOps } from "./useMultiCursorOps";

describe("useMultiCursorOps", () => {
  it("adds and clears extra cursors accurately", () => {
    const documentLines = ["const a = 1;", "const b = 2;"];
    const { result } = renderHook(() => useMultiCursorOps(documentLines));

    expect(result.current.extraCursors.length).toBe(0);

    act(() => {
      result.current.addCursor({ line: 1, char: 6 });
    });

    expect(result.current.extraCursors.length).toBe(1);
    expect(result.current.extraCursors[0]).toEqual({ line: 1, char: 6 });

    act(() => {
      result.current.clearExtraCursors();
    });

    expect(result.current.extraCursors.length).toBe(0);
  });
});
