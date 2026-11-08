import { useState } from "react";
import { Input } from "../../../UI/Components/Input";
import { Icons } from "../../../UI/Icons/IconManager";

interface InlineInputProps {
  type: "file" | "folder";
  depth: number;
  initialValue?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function InlineInput({
  type,
  depth,
  initialValue = "",
  onSubmit,
  onCancel,
}: InlineInputProps) {
  const [value, setValue] = useState(initialValue);

  const commit = () => {
    if (value.trim() && value !== initialValue) onSubmit(value);
    else onCancel();
  };

  return (
    <div className="flex flex-col relative">
      {depth > 0 &&
        Array.from({ length: depth }, (_, index) => index + 1).map((guide) => (
          <div
            key={`inline-guide-${guide}`}
            className="absolute top-0 bottom-0 border-l border-[var(--border-subtle)]/60 pointer-events-none"
            style={{ left: `calc(${guide - 1} * var(--TreeIndent) + 14px)` }}
          />
        ))}
      <div
        className="mx-1 flex h-[24px] items-center gap-1 pr-1 rounded-[4px]"
        style={{ paddingLeft: `calc(${depth} * var(--TreeIndent) + 4px)` }}
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0" />
        <div className="shrink-0 flex items-center">
          {type === "folder" ? (
            <Icons.Folder size={16} stroke={2} className="text-[var(--color-accent)]" />
          ) : (
            <Icons.File size={16} stroke={1.5} className="text-[var(--color-text-highlight)]" />
          )}
        </div>
        <Input
          autoFocus
          inputSize="sm"
          fullWidth
          className="h-[22px] min-w-0 flex-1 rounded-[4px]"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") onCancel();
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
}
