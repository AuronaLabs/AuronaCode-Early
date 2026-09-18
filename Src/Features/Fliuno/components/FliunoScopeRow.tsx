import { type FliunoScope } from "../../../Core/Fliuno/FliunoCore";
import { useLocale } from "../../../Foundation/I18n";
import { cn } from "../../../Shared/Utils/cn";
import { FilterChips } from "../../../UI/Components/FilterChips";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";
import { FLIUNO_SCOPE_OPTIONS } from "./scopeOptions";

interface FliunoScopeRowProps {
  scope: FliunoScope;
  onScopeChange: (scope: FliunoScope) => void;
  caseSensitive: boolean;
  regex: boolean;
  onToggleCaseSensitive: () => void;
  onToggleRegex: () => void;
  count: number;
  /** 工作区文件索引整理中（modal 场景） */
  indexing?: boolean;
  /** sm: 侧栏；md: 页面 / 悬浮窗 */
  size?: "sm" | "md";
  className?: string;
}

const toggleButtonClass = (active: boolean) =>
  cn(
    "rounded-lg p-1.5 transition-colors",
    active
      ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
      : "text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)]",
  );

/** Modal 与工作区页共用的 scope 工具行：FilterChips + 内容搜索大小写/正则 + 结果计数。 */
export function FliunoScopeRow({
  scope,
  onScopeChange,
  caseSensitive,
  regex,
  onToggleCaseSensitive,
  onToggleRegex,
  count,
  indexing = false,
  size = "sm",
  className,
}: FliunoScopeRowProps) {
  const { t } = useLocale();
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <FilterChips
        size={size}
        className="flex-1"
        ariaLabel={t("fliuno.surfaceLabel")}
        value={scope}
        onChange={onScopeChange}
        items={FLIUNO_SCOPE_OPTIONS.map((option) => ({
          id: option.id,
          label: t(option.labelKey),
        }))}
      />
      {scope === "content" && (
        <>
          <span className="mx-1 h-4 w-px shrink-0 bg-[var(--border-subtle)]" />
          <Tooltip content={t("fliuno.caseSensitive")} placement="bottom">
            <button
              type="button"
              aria-label={t("fliuno.caseSensitive")}
              aria-pressed={caseSensitive}
              onClick={onToggleCaseSensitive}
              className={toggleButtonClass(caseSensitive)}
            >
              <Icons.Typography size={13} stroke={caseSensitive ? 2.5 : 2} />
            </button>
          </Tooltip>
          <Tooltip content={t("fliuno.regex")} placement="bottom">
            <button
              type="button"
              aria-label={t("fliuno.regex")}
              aria-pressed={regex}
              onClick={onToggleRegex}
              className={toggleButtonClass(regex)}
            >
              <Icons.Asterisk size={13} stroke={regex ? 2.5 : 2} />
            </button>
          </Tooltip>
        </>
      )}
      <span className="ml-auto shrink-0 pr-1 text-[10px] text-[var(--color-text-muted)]">
        {indexing ? t("fliuno.indexing") : t("fliuno.resultsCount").replace("{count}", String(count))}
      </span>
    </div>
  );
}
