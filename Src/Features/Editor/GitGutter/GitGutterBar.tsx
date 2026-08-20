import React from "react";

export interface GitGutterBarProps {
  isAdded?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
}

export const GitGutterBar = React.memo(function GitGutterBar({
  isAdded,
  isModified,
  isDeleted,
}: GitGutterBarProps) {
  if (isAdded) {
    return (
      <span aria-hidden="true" className="absolute right-0 top-0 bottom-0 w-[3px] bg-[#22c55e]" />
    );
  }
  if (isModified) {
    return (
      <span aria-hidden="true" className="absolute right-0 top-0 bottom-0 w-[3px] bg-[#3b82f6]" />
    );
  }
  if (isDeleted) {
    return (
      <span
        aria-hidden="true"
        className="absolute right-0 top-0 border-t-[4px] border-r-[4px] border-t-transparent border-r-[#ef4444]"
      />
    );
  }
  return null;
});
