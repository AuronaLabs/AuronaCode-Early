import { useMemo } from "react";
import { cn } from "../../../Shared/Utils/cn";
import { glassVariants } from "../../../UI/Core/GlassManager/variants";

export interface EditorHoverState {
  x: number;
  y: number;
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

export function HoverCard({ hover, onMouseEnter, onMouseLeave }: HoverCardProps) {
  const blocks = useMemo(() => parseHoverBlocks(hover.text), [hover.text]);
  const left = Math.max(8, Math.min(hover.x, window.innerWidth - 428));
  const top = Math.max(8, Math.min(hover.y, window.innerHeight - 288));

  return (
    <div
      role="tooltip"
      aria-live="polite"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        glassVariants({ layer: "floating" }),
        "fixed z-[80] max-h-[280px] w-max min-w-[220px] max-w-[420px] overflow-y-auto rounded-xl p-3 font-sans text-[12px] text-[var(--TextPrimary)] shadow-2xl aurona-scroll",
        hover.tone === "warning" && "border-amber-500/30",
        hover.tone === "error" && "border-red-500/30",
      )}
      style={{ top, left }}
    >
      {(hover.title || hover.source) && (
        <div className="mb-2 flex items-center justify-between gap-4 border-b border-[var(--GlassBorder)] pb-2">
          <span className="font-semibold text-[var(--TextHighlight)]">
            {hover.title ?? "语言服务"}
          </span>
          {hover.source && (
            <span className="font-mono text-[10px] text-[var(--TextMuted)]">{hover.source}</span>
          )}
        </div>
      )}
      <div className="space-y-2">
        {blocks.map((block) =>
          block.kind === "code" ? (
            <div
              key={block.id}
              className="overflow-x-auto rounded-lg bg-[var(--material-surface)] p-2 font-mono text-[11px] leading-relaxed text-[var(--TextHighlight)]"
            >
              {block.language && (
                <div className="mb-1 text-[9px] uppercase tracking-wide text-[var(--TextMuted)]">
                  {block.language}
                </div>
              )}
              <pre className="whitespace-pre-wrap">{block.value}</pre>
            </div>
          ) : (
            <div key={block.id} className="whitespace-pre-wrap break-words leading-relaxed">
              {block.value}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
