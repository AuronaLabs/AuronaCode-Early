import {
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconReplace,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../../Foundation/I18n";
import { cn } from "../../../Shared/Utils/cn";
import { glassVariants } from "../../../UI/Core/GlassManager/variants";
import type { EditorSearchOptions } from "../Hooks/useEditorSearch";

export interface SearchWidgetProps {
  onSearch: (query: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  totalMatches: number;
  currentIndex: number;
  options: EditorSearchOptions;
  onOptionsChange: (options: EditorSearchOptions) => void;
  /** 查询串非法（仅正则模式可能出现） */
  invalidQuery: boolean;
  replaceValue: string;
  onReplaceValueChange: (value: string) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
}

interface ToggleOptionProps {
  label: string;
  ariaLabel: string;
  active: boolean;
  onToggle: () => void;
}

function ToggleOption({ label, ariaLabel, active, onToggle }: ToggleOptionProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        "h-7 min-w-7 px-1 rounded-lg flex items-center justify-center text-[12px] font-semibold transition-colors select-none",
        active
          ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]",
      )}
    >
      {label}
    </button>
  );
}

export function SearchWidget({
  onSearch,
  onClose,
  onNext,
  onPrev,
  totalMatches,
  currentIndex,
  options,
  onOptionsChange,
  invalidQuery,
  replaceValue,
  onReplaceValueChange,
  onReplace,
  onReplaceAll,
}: SearchWidgetProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 挂载时自动聚焦
    inputRef.current?.focus();
  }, []);

  const toggleOption = (key: keyof EditorSearchOptions) => {
    onOptionsChange({ ...options, [key]: !options[key] });
  };

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

  const handleReplaceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onReplace();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    onSearch(e.target.value);
  };

  const toggleReplace = () => {
    setReplaceOpen((open) => {
      if (!open) window.setTimeout(() => replaceInputRef.current?.focus(), 0);
      return !open;
    });
  };

  const toggleButtonClass =
    "w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] transition-colors";

  return (
    <div
      className={cn(
        glassVariants({ layer: "overlay" }),
        "absolute top-4 right-8 z-50 flex flex-col rounded-xl overflow-hidden font-sans transition-all w-[400px]",
      )}
    >
      <div
        className={cn(
          "flex items-center h-10 pl-2 pr-0",
          replaceOpen && "border-b border-[var(--border-subtle)]",
        )}
      >
        <button
          type="button"
          aria-label={t("editor.searchToggleReplace")}
          onClick={toggleReplace}
          className={cn(toggleButtonClass, "mr-1 shrink-0")}
        >
          {replaceOpen ? (
            <IconChevronDown size={14} stroke={2} />
          ) : (
            <IconChevronRight size={14} stroke={2} />
          )}
        </button>

        <IconSearch
          size={14}
          stroke={2}
          className="mr-2.5 shrink-0 text-[var(--color-text-muted)]"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t("editor.searchPlaceholder")}
          className="h-full min-w-0 flex-1 border-none bg-transparent font-medium text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
        />

        <div className="flex items-center shrink-0 pr-2">
          <ToggleOption
            label="Aa"
            ariaLabel={t("editor.searchMatchCase")}
            active={options.matchCase}
            onToggle={() => toggleOption("matchCase")}
          />
          <ToggleOption
            label="ab"
            ariaLabel={t("editor.searchWholeWord")}
            active={options.wholeWord}
            onToggle={() => toggleOption("wholeWord")}
          />
          <ToggleOption
            label=".*"
            ariaLabel={t("editor.searchRegex")}
            active={options.useRegex}
            onToggle={() => toggleOption("useRegex")}
          />
        </div>

        <div className="flex h-10 shrink-0 items-center justify-center whitespace-nowrap px-2 text-[11px] font-medium text-[var(--color-text-muted)]">
          {invalidQuery
            ? t("editor.searchInvalidRegex")
            : totalMatches > 0
              ? `${currentIndex + 1} / ${totalMatches}`
              : t("editor.searchNoResults")}
        </div>

        <div className="flex items-center h-full pr-1 shrink-0">
          <button
            type="button"
            onClick={onPrev}
            disabled={totalMatches === 0}
            className={cn(
              toggleButtonClass,
              "mr-0.5 disabled:opacity-30 disabled:cursor-not-allowed",
            )}
          >
            <IconChevronUp size={14} stroke={2} />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={totalMatches === 0}
            className={cn(
              toggleButtonClass,
              "mr-1 disabled:opacity-30 disabled:cursor-not-allowed",
            )}
          >
            <IconChevronDown size={14} stroke={2} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className={cn(toggleButtonClass, "ml-0.5 hover:bg-[var(--DiagError)] hover:text-white")}
          >
            <IconX size={14} stroke={2} />
          </button>
        </div>
      </div>

      {replaceOpen && (
        <div className="flex items-center h-10 pl-2 pr-1">
          <IconReplace
            size={14}
            stroke={2}
            className="mr-2.5 shrink-0 text-[var(--color-text-muted)]"
          />
          <input
            ref={replaceInputRef}
            type="text"
            value={replaceValue}
            onChange={(e) => onReplaceValueChange(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder={t("editor.searchReplacePlaceholder")}
            className="h-full min-w-0 flex-1 border-none bg-transparent font-medium text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          />
          <button
            type="button"
            onClick={onReplace}
            disabled={totalMatches === 0}
            className="h-7 px-2.5 mr-1 rounded-lg text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {t("editor.searchReplace")}
          </button>
          <button
            type="button"
            onClick={onReplaceAll}
            disabled={totalMatches === 0}
            className="h-7 px-2.5 rounded-lg text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {t("editor.searchReplaceAll")}
          </button>
        </div>
      )}
    </div>
  );
}
