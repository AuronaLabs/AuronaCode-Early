import type { ReactNode } from "react";

/** Modal 与工作区页共用的高亮文本：命中区间以 accent 底色 mark 呈现。 */
export function HighlightedText({
  text,
  ranges,
  className,
}: {
  text: string;
  ranges: Array<[number, number]>;
  className?: string;
}) {
  if (!ranges.length) {
    return className ? <span className={className}>{text}</span> : text;
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={`${start}-${end}`}
        className="rounded-[2px] bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] text-[var(--color-text-highlight)]"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <span className={className}>{parts}</span>;
}
