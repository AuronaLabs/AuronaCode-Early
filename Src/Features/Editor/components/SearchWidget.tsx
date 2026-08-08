import { IconChevronDown, IconChevronUp, IconSearch, IconX } from "@tabler/icons-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../../Foundation/I18n";
import { cn } from "../../../Shared/Utils/cn";
import { glassVariants } from "../../../UI/Core/GlassManager/variants";

export interface SearchWidgetProps {
  onSearch: (query: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  totalMatches: number;
  currentIndex: number;
}

export function SearchWidget({
  onSearch,
  onClose,
  onNext,
  onPrev,
  totalMatches,
  currentIndex,
}: SearchWidgetProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 挂载时自动聚焦
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    onSearch(e.target.value);
  };

  return (
    <div
      className={cn(
        glassVariants({ layer: "floating" }),
        "absolute top-4 right-8 z-50 flex items-center rounded-xl overflow-hidden h-10 font-sans transition-all w-[340px]",
      )}
    >
      <div className="flex-1 flex items-center pl-4 pr-3 h-full">
        <IconSearch size={14} stroke={2} className="mr-2.5 text-[var(--color-text-muted)]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t("editor.searchPlaceholder")}
          className="h-full w-full border-none bg-transparent font-medium text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
        />
      </div>

      <div className="flex h-full items-center justify-center whitespace-nowrap px-3 text-[11px] font-medium text-[var(--color-text-muted)]">
        {totalMatches > 0 ? `${currentIndex + 1} / ${totalMatches}` : t("editor.searchNoResults")}
      </div>

      <div className="flex items-center h-full pr-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={totalMatches === 0}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors mr-0.5"
        >
          <IconChevronUp size={14} stroke={2} />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={totalMatches === 0}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors mr-1"
        >
          <IconChevronDown size={14} stroke={2} />
        </button>
        <div className="w-[1px] h-4 bg-[var(--border-subtle)] mx-1"></div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--DiagError)] hover:text-white transition-colors ml-1"
        >
          <IconX size={14} stroke={2} />
        </button>
      </div>
    </div>
  );
}
