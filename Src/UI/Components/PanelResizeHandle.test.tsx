import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PanelResizeHandle } from "./PanelResizeHandle";

beforeAll(() => {
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: MouseEvent,
  });
});

const renderHandle = (
  orientation: "vertical" | "horizontal",
  value: number,
  onChange = vi.fn(),
  onCommit = vi.fn(),
) => {
  render(
    <PanelResizeHandle
      orientation={orientation}
      value={value}
      min={100}
      max={600}
      defaultValue={260}
      label="调整面板"
      onChange={onChange}
      onCommit={onCommit}
    />,
  );
  return { handle: screen.getByRole("separator"), onChange, onCommit };
};

describe("PanelResizeHandle", () => {
  it("adjusts a vertical panel with the arrow keys", () => {
    const { handle, onChange, onCommit } = renderHandle("vertical", 260);

    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith(268);
    expect(onCommit).toHaveBeenCalledWith(268);
  });

  it("grows a bottom panel when dragging upward", () => {
    const { handle, onChange, onCommit } = renderHandle("horizontal", 300);

    fireEvent.pointerDown(handle, { button: 0, clientY: 500 });
    fireEvent.pointerMove(window, { clientY: 440 });
    fireEvent.pointerUp(window);

    expect(onChange).toHaveBeenCalledWith(360);
    expect(onCommit).toHaveBeenCalledWith(360);
  });

  it("restores the default size on double click", () => {
    const { handle, onChange, onCommit } = renderHandle("vertical", 420);

    fireEvent.doubleClick(handle);

    expect(onChange).toHaveBeenCalledWith(260);
    expect(onCommit).toHaveBeenCalledWith(260);
  });
});
