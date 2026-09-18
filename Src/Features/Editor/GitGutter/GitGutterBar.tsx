import React from "react";

export interface GitGutterBarProps {
  isAdded?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
  /** 传入即可点击：参数为热区矩形，用于锚定 hunk 浮层 */
  onClick?: (anchor: DOMRect) => void;
}

export const GitGutterBar = React.memo(function GitGutterBar({
  isAdded,
  isModified,
  isDeleted,
  onClick,
}: GitGutterBarProps) {
  if (!isAdded && !isModified && !isDeleted) {
    return null;
  }

  const bar = isAdded ? (
    <span
      aria-hidden="true"
      className="absolute right-0 top-0 bottom-0 w-[3px] bg-[var(--StatusSuccess)]"
    />
  ) : isModified ? (
    <span
      aria-hidden="true"
      className="absolute right-0 top-0 bottom-0 w-[3px] bg-[var(--StatusInfo)]"
    />
  ) : (
    <span
      aria-hidden="true"
      className="absolute right-0 top-0 border-t-[4px] border-r-[4px] border-t-transparent border-r-[var(--StatusError)]"
    />
  );

  if (!onClick) {
    return bar;
  }

  return (
    <button
      type="button"
      onClick={(event) => onClick(event.currentTarget.getBoundingClientRect())}
      className="absolute right-0 top-0 bottom-0 w-2 cursor-pointer"
    >
      {bar}
    </button>
  );
});
