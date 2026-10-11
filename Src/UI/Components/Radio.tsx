import type * as React from "react";
import { cn } from "../../Shared/Utils/cn";

export interface RadioOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface RadioProps {
  name: string;
  value?: string;
  options: RadioOption[];
  onChange?: (value: string) => void;
  className?: string;
}

export function Radio({ name, value, options, onChange, className }: RadioProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)} role="radiogroup">
      {options.map((option) => (
        <label key={option.value} className="inline-flex items-center gap-2 text-[13px]">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => onChange?.(option.value)}
            className="size-4 accent-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
