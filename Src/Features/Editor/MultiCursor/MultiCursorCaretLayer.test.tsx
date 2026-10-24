import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_LAYOUT } from "../Utils/EditorLayoutMetrics";
import { MultiCursorCaretLayer } from "./MultiCursorCaretLayer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("rendered caret alignment", () => {
  it("uses the same DOM geometry for primary carets and extra selections after reflow", () => {
    let scale = 1;
    const positions = [8, 18, 38, 48, 58, 68];
    const original = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = original();
      range.getBoundingClientRect = () =>
        ({
          left: 100 + positions[range.startOffset] * scale,
          width: (positions[range.endOffset] - positions[range.startOffset]) * scale,
          height: 24,
        }) as DOMRect;
      return range;
    });
    const line = document.createElement("button");
    line.innerHTML = "<span data-editor-text-content>a中\t😀</span>";
    line.getBoundingClientRect = () => ({ left: 100 }) as DOMRect;
    const props = {
      primaryCursor: { line: 0, char: 5 },
      extras: [
        {
          cursor: { line: 0, char: 2 },
          selection: { start: { line: 0, char: 2 }, end: { line: 0, char: 5 } },
        },
      ],
      documentLines: ["a中\t😀"],
      lineElementsRef: { current: new Map([[0, line]]) },
      layout: DEFAULT_EDITOR_LAYOUT,
    };
    const { container, rerender } = render(<MultiCursorCaretLayer {...props} />);
    const caret = container.querySelector<HTMLElement>(".editor-caret");
    const selection = container.querySelector<HTMLElement>("[data-caret-end]");
    expect(caret?.style.left).toBe("68px");
    expect(selection?.style.left).toBe("38px");
    expect(selection?.style.width).toBe("30px");
    scale = 1.5;
    rerender(<MultiCursorCaretLayer {...props} layout={{ ...props.layout, fontSize: 21 }} />);
    expect(caret?.style.left).toBe("102px");
    expect(selection?.style.left).toBe("57px");
    expect(selection?.style.width).toBe("45px");
  });
});
