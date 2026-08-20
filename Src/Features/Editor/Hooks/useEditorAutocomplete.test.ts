import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_LAYOUT } from "../Utils/EditorLayoutMetrics";
import { useEditorAutocomplete } from "./useEditorAutocomplete";

describe("useEditorAutocomplete hook", () => {
  it("initializes with empty completions and provides selection callback", () => {
    const replaceDocumentLines = vi.fn();
    const setVisibleHover = vi.fn();
    const containerRef = { current: document.createElement("div") };

    const { result } = renderHook(() =>
      useEditorAutocomplete({
        path: "test.ts",
        language: "typescript",
        layout: DEFAULT_EDITOR_LAYOUT,
        languagePreferences: {
          hoverEnabled: true,
          hoverDelayMs: 600,
          automaticCompletion: true,
        },
        containerRef,
        caretPos: { x: 50, y: 50 },
        scrollTop: 0,
        documentLines: ["const test = 1;"],
        cursor: { line: 0, char: 10 },
        replaceDocumentLines,
        setVisibleHover,
      }),
    );

    expect(result.current.completions).toEqual([]);
    expect(result.current.completionIndex).toBe(0);

    act(() => {
      result.current.setCompletions([
        {
          label: "testVar",
          insertText: "testVar",
          kind: 6,
          detail: "number",
        },
      ]);
    });

    expect(result.current.completions.length).toBe(1);

    act(() => {
      result.current.closeAutocomplete();
    });

    expect(result.current.completions).toEqual([]);
  });
});
