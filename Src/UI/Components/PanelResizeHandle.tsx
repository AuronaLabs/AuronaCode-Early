import { useEffect, useRef } from "react";
import { cn } from "../../Shared/Utils/cn";

type PanelResizeOrientation = "vertical" | "horizontal";

interface PanelResizeHandleProps {
  orientation: PanelResizeOrientation;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  label: string;
  onChange(value: number): void;
  onCommit(value: number): void;
  className?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(Math.round(value), min), max);

export function PanelResizeHandle({
  orientation,
  value,
  min,
  max,
  defaultValue,
  label,
  onChange,
  onCommit,
  className,
}: PanelResizeHandleProps) {
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

  const resizeTo = (nextValue: number, commit = false) => {
    const normalized = clamp(nextValue, min, max);
    valueRef.current = normalized;
    onChange(normalized);
    if (commit) onCommit(normalized);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLHRElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startPosition = orientation === "vertical" ? event.clientX : event.clientY;
    const startValue = valueRef.current;
    document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const position = orientation === "vertical" ? pointerEvent.clientX : pointerEvent.clientY;
      const delta =
        orientation === "vertical" ? position - startPosition : startPosition - position;
      resizeTo(startValue + delta);
    };

    const finish = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onCommit(valueRef.current);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLHRElement>) => {
    const step = event.shiftKey ? 32 : 8;
    const delta =
      orientation === "vertical"
        ? event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0
        : event.key === "ArrowDown"
          ? -step
          : event.key === "ArrowUp"
            ? step
            : 0;
    if (!delta) return;
    event.preventDefault();
    resizeTo(valueRef.current + delta, true);
  };

  const vertical = orientation === "vertical";

  return (
    <hr
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      data-orientation={orientation}
      className={cn(
        "aurona-panel-resizer relative z-20 m-0 shrink-0 touch-none border-0 bg-transparent outline-none",
        vertical
          ? "h-full w-[var(--WorkspaceGap)] cursor-col-resize"
          : "h-[var(--WorkspaceGap)] w-full cursor-row-resize",
        className,
      )}
      onPointerDown={handlePointerDown}
      onDoubleClick={() => resizeTo(defaultValue, true)}
      onKeyDown={handleKeyDown}
    />
  );
}
