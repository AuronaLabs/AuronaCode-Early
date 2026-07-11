import { useState } from "react";
import { Icons } from "../../../UI/Icons/IconManager";
import { Input } from "../../../UI/Components/Input";

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
        Array.from({ length: depth }).map((_, index) => (
          <div
            key={index}
            className="absolute top-0 bottom-0 border-l border-[var(--GlassBorder)]/60 pointer-events-none"
            style={{ left: `calc(${index} * var(--TreeIndent) + 14px)` }}
          />
        ))}
      <div
        className="flex items-center gap-1.5 py-1 px-1 rounded-lg"
        style={{ paddingLeft: `calc(${depth} * var(--TreeIndent) + 4px)` }}
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0" />
        <div className="shrink-0 flex items-center">
          {type === "folder" ? (
            <Icons.Folder size={16} stroke={2} className="text-[var(--AccentPrimary)]" />
          ) : (
            <Icons.File size={16} stroke={1.5} className="text-[var(--TextHighlight)]" />
          )}
        </div>
        <Input
          autoFocus
          inputSize="sm"
          fullWidth
          className="ml-1"
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
