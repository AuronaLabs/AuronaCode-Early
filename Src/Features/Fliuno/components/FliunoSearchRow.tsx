import type { KeyboardEvent, Ref } from "react";
import { useLocale } from "../../../Foundation/I18n";
import { cn } from "../../../Shared/Utils/cn";
import { Icons } from "../../../UI/Icons/IconManager";

interface FliunoSearchRowProps {
  query: string;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  /** modal: 悬浮窗内的裸行（52px，材质由外层 section 承担）；md: 页面工具行；sm: 侧栏紧凑行 */
  variant?: "modal" | "md" | "sm";
  inputRef?: Ref<HTMLInputElement>;
  /** modal 的 combobox aria 三件套 */
  combobox?: { expanded: boolean; controlsId: string; activeDescendant?: string };
  className?: string;
}

/** Modal 与工作区页共用的搜索输入行：图标 + 输入 + 清除按钮。 */
export function FliunoSearchRow({
  query,
  onQueryChange,
  onClear,
  onKeyDown,
  placeholder,
  variant = "md",
  inputRef,
  combobox,
  className,
}: FliunoSearchRowProps) {
  const { t } = useLocale();
  return (
    <div
      className={cn(
        variant === "modal" && "h-[52px] items-center gap-3 px-4",
        variant === "md" &&
          "glass-layer-overlay h-12 shrink-0 items-center gap-3 rounded-control border border-[var(--border-overlay)] bg-[var(--material-panel)] px-4 backdrop-blur-[var(--glass-blur-overlay)] backdrop-saturate-[var(--GlassSaturation)] transition-[border-color,box-shadow] focus-within:border-[var(--color-text-muted)]/25 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-text-muted)_14%,transparent)]",
        variant === "sm" &&
          "glass-layer-overlay h-10 shrink-0 items-center gap-2 rounded-control border border-[var(--border-overlay)] bg-[var(--material-panel)] px-3 backdrop-blur-[var(--glass-blur-overlay)] backdrop-saturate-[var(--GlassSaturation)] transition-[border-color,box-shadow] focus-within:border-[var(--color-text-muted)]/25 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-text-muted)_14%,transparent)]",
        "flex",
        className,
      )}
    >
      <Icons.Search size={16} stroke={1.8} className="shrink-0 text-[var(--color-text-muted)]" />
      <input
        ref={inputRef}
        data-fliuno-input
        data-aurona-input="embedded"
        {...(combobox
          ? {
              role: "combobox",
              "aria-expanded": combobox.expanded,
              "aria-controls": combobox.controlsId,
              "aria-activedescendant": combobox.activeDescendant,
            }
          : {})}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cn(
          "h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 font-medium text-[var(--color-text-highlight)] outline-none ring-0 placeholder:font-normal placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0",
          variant === "sm" ? "text-[13px]" : "text-[14px]",
        )}
      />
      {query && (
        <button
          type="button"
          aria-label={t("common.clear")}
          onClick={onClear}
          className="rounded-control p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
        >
          <Icons.Close size={14} />
        </button>
      )}
    </div>
  );
}
