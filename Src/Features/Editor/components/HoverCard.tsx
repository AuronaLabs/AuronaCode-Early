import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../Shared/Utils/cn";
import { glassVariants } from "../../../UI/Core/GlassManager/variants";
import { type EditorOverlayAnchor, positionEditorOverlay } from "../Utils/EditorOverlay";

export interface EditorHoverState {
  anchor: EditorOverlayAnchor;
  title?: string;
  text: string;
  source?: string;
  tone?: "default" | "warning" | "error";
}

interface HoverCardProps {
  hover: EditorHoverState;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

interface HoverBlock {
  id: string;
  kind: "text" | "code";
  language?: string;
  value: string;
}

const parseHoverBlocks = (value: string): HoverBlock[] => {
  const blocks: HoverBlock[] = [];
  const pattern = /```([^\n]*)\n?([\s\S]*?)```/g;
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = value.slice(offset, index).trim();
    if (before) blocks.push({ id: `text-${offset}`, kind: "text", value: before });
    blocks.push({
      id: `code-${index}`,
      kind: "code",
      language: match[1]?.trim() || undefined,
      value: match[2]?.trimEnd() ?? "",
    });
    offset = index + match[0].length;
  }
  const remaining = value.slice(offset).trim();
  if (remaining) blocks.push({ id: `text-${offset}`, kind: "text", value: remaining });
  return blocks.length ? blocks : [{ id: "text-0", kind: "text", value }];
};

const renderRichText = (value: string) => {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={part} className="font-semibold text-[var(--color-text-highlight)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={part}
          className="rounded bg-[var(--material-surface)] px-1 py-0.5 font-mono text-[10.5px] text-[var(--color-accent)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
};

export function HoverCard({ hover, onMouseEnter, onMouseLeave }: HoverCardProps) {
  const blocks = useMemo(() => parseHoverBlocks(hover.text), [hover.text]);
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(() =>
    positionEditorOverlay(
      hover.anchor,
      { width: 420, height: 280 },
      { width: window.innerWidth, height: window.innerHeight },
    ),
  );

  useLayoutEffect(() => {
    const update = () => {
      const card = cardRef.current;
      setPosition(
        positionEditorOverlay(
          hover.anchor,
          { width: card?.offsetWidth ?? 420, height: card?.offsetHeight ?? 280 },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [hover.anchor]);

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      aria-live="polite"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        glassVariants({ layer: "overlay" }),
        "fixed z-[80] max-h-[320px] w-max min-w-[240px] max-w-[440px] overflow-y-auto rounded-xl p-3 font-sans text-[12px] text-[var(--color-text-primary)] aurona-scroll",
        hover.tone === "warning" && "border-amber-500/30",
        hover.tone === "error" && "border-red-500/30",
      )}
      data-placement={position.placement}
      style={{ top: position.top, left: position.left }}
    >
      {(hover.title || hover.source) && (
        <div className="mb-2 flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-2">
          <span className="flex items-center gap-2 font-semibold text-[var(--color-text-highlight)]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
            {hover.title ?? "语言服务"}
          </span>
          {hover.source && (
            <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
              {hover.source}
            </span>
          )}
        </div>
      )}
      <div className="space-y-2">
        {blocks.map((block) =>
          block.kind === "code" ? (
            <div
              key={block.id}
              className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--material-surface)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--color-text-highlight)]"
            >
              {block.language && (
                <div className="mb-1 text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  {block.language}
                </div>
              )}
              <pre className="whitespace-pre-wrap">{block.value}</pre>
            </div>
          ) : (
            <div key={block.id} className="whitespace-pre-wrap break-words leading-relaxed">
              {renderRichText(block.value)}
            </div>
          ),
        )}
      </div>
    </div>,
    document.body,
  );
}
