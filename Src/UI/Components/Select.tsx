import { useState, useRef, useEffect } from "react";
import { Icons } from "../Icons/IconManager";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Select({ options, value, onChange, className = "" }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      window.addEventListener("mousedown", handleClickOutside);
    }
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full min-w-[120px] items-center justify-between gap-3 bg-black/5 dark:bg-white/10 border border-[var(--GlassBorder)] rounded-md px-3 py-1.5 text-[13px] text-[var(--TextHighlight)] outline-none hover:bg-black/10 dark:hover:bg-white/20 transition-colors cursor-pointer"
      >
        <span className="truncate">{selectedOption?.label || value}</span>
        <Icons.ChevronDown size={14} className={`text-[var(--TextMuted)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute z-[100] top-full mt-1 w-full max-h-60 overflow-y-auto no-scrollbar rounded-md border border-[var(--GlassBorder)] bg-white/80 dark:bg-black/80 backdrop-blur-xl shadow-lg p-1 animate-in fade-in slide-in-from-top-1 duration-200">
          {options.map((opt) => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={`px-3 py-1.5 text-[12px] rounded cursor-pointer transition-colors ${
                opt.value === value
                  ? "bg-[var(--AccentPrimary)] text-white"
                  : "text-[var(--TextPrimary)] hover:bg-black/5 dark:hover:bg-white/10 hover:text-[var(--TextHighlight)]"
              }`}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
