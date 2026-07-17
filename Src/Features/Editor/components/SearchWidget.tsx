import { IconChevronDown, IconChevronUp, IconSearch, IconX } from "@tabler/icons-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
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
        <IconSearch size={14} stroke={2} className="text-gray-400 dark:text-gray-500 mr-2.5" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="搜索..."
          className="w-full h-full bg-transparent border-none outline-none text-[13px] text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 font-medium"
        />
      </div>

      <div className="flex items-center justify-center px-3 text-[11px] text-gray-400 dark:text-gray-500 font-medium whitespace-nowrap h-full">
        {totalMatches > 0 ? `${currentIndex + 1} / ${totalMatches}` : "无结果"}
      </div>

      <div className="flex items-center h-full pr-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={totalMatches === 0}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-[var(--GlassHover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors mr-0.5"
        >
          <IconChevronUp size={14} stroke={2} />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={totalMatches === 0}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-[var(--GlassHover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors mr-1"
        >
          <IconChevronDown size={14} stroke={2} />
        </button>
        <div className="w-[1px] h-4 bg-black/10 bg-[var(--GlassSurface-Elevated)] mx-1"></div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-red-500 hover:text-white dark:hover:bg-red-500 dark:hover:text-white transition-colors ml-1"
        >
          <IconX size={14} stroke={2} />
        </button>
      </div>
    </div>
  );
}
