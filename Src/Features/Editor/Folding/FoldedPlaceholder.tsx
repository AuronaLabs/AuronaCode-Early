import React from "react";

export interface FoldedPlaceholderProps {
  onClick: () => void;
  hiddenCount?: number;
}

export const FoldedPlaceholder = React.memo(function FoldedPlaceholder({
  onClick,
  hiddenCount,
}: FoldedPlaceholderProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={`已折叠 ${hiddenCount ?? ""} 行，点击展开`}
      className="inline-flex items-center justify-center px-1.5 py-0.2 mx-1 rounded bg-[var(--material-surface)] hover:bg-[var(--material-interactive-hover)] border border-[var(--border-subtle)] text-[10px] font-mono text-[var(--color-accent)] cursor-pointer select-none transition-colors align-middle shadow-xs"
    >
      ...
    </button>
  );
});
