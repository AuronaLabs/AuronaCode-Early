import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../Shared/Utils/cn";
import { glassVariants } from "../../../UI/Core/GlassManager/variants";
import { Icons } from "../../../UI/Icons/IconManager";
import type { GitGutterHunk } from "./parseUnifiedDiff";

interface GitGutterPopoverProps {
  hunk: GitGutterHunk;
  /** gutter 指示条锚点（视口坐标） */
  anchorTop: number;
  anchorRight: number;
  onClose: () => void;
}

const VIEWPORT_MARGIN = 8;

/** gutter hunk 浮层：展示当前变更块的 +/- 行（不做 Blame、不做 hunk 间导航） */
export function GitGutterPopover({ hunk, anchorTop, anchorRight, onClose }: GitGutterPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({
    left: anchorRight + VIEWPORT_MARGIN,
    top: Math.max(VIEWPORT_MARGIN, anchorTop - 4),
  });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { offsetWidth: width, offsetHeight: height } = panel;
    let left = anchorRight + VIEWPORT_MARGIN;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    }
    let top = anchorTop - 4;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    }
    setPosition({ left, top: Math.max(VIEWPORT_MARGIN, top) });
  }, [anchorTop, anchorRight]);

  // Esc / 点击外部 / 任意滚动 关闭（锚点不跟随滚动）
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const added = hunk.rows.filter((row) => row.kind === "add").length;
  const removed = hunk.rows.length - added;

  return createPortal(
    <div
      ref={panelRef}
      className={cn(
        glassVariants({ layer: "overlay" }),
        "fixed z-[9998] w-[400px] max-w-[90vw] rounded-xl overflow-hidden shadow-[var(--shadow-surface),var(--GlassSurface-Shadow-Base)] animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none",
      )}
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold tabular-nums">
          <span className="text-[var(--StatusSuccess)]">+{added}</span>
          <span className="text-[var(--StatusError)]">−{removed}</span>
          <span className="font-medium text-[var(--color-text-muted)]">L{hunk.startLine + 1}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="flex h-4 w-4 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] cursor-pointer"
        >
          <Icons.Close size={12} />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto aurona-scroll font-mono text-[11px] leading-[18px]">
        {hunk.rows.map((row, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: 纯展示 diff 行，无稳定唯一键
            key={index}
            className={cn(
              "px-2 whitespace-pre",
              row.kind === "add"
                ? "bg-[color-mix(in_srgb,var(--StatusSuccess)_10%,transparent)] text-[var(--color-text-highlight)]"
                : "bg-[color-mix(in_srgb,var(--StatusError)_10%,transparent)] text-[var(--color-text-muted)]",
            )}
          >
            <span className="select-none pr-1.5 opacity-60">{row.kind === "add" ? "+" : "−"}</span>
            {row.text || " "}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
