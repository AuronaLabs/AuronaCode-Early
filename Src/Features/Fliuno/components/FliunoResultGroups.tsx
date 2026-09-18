import type { ReactNode } from "react";
import type { FliunoCoreResult, FliunoCoreResultKind } from "../../../Core/Fliuno/FliunoCore";
import { cn } from "../../../Shared/Utils/cn";
import { Icons } from "../../../UI/Icons/IconManager";
import { HighlightedText } from "./HighlightedText";

/** 分组 sticky 组头：modal 传 material-panel 底，工作区页传 AppBackground 底。 */
export function FliunoGroupHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 bg-[var(--AppBackground,var(--AppBg))] text-[9px] font-semibold tracking-wider text-[var(--color-text-muted)]/80 uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ResultIcon({ kind }: { kind: FliunoCoreResultKind }) {
  switch (kind) {
    case "command":
      return <Icons.Command size={14} stroke={1.8} />;
    case "file":
      return <Icons.FileCode size={14} stroke={1.8} />;
    case "setting":
      return <Icons.Settings size={14} stroke={1.8} />;
    case "symbol":
      return <Icons.Sparkles size={14} stroke={1.8} />;
    case "extension":
      return <Icons.Extensions size={14} stroke={1.8} />;
    case "content":
      return <Icons.Search size={14} stroke={1.8} />;
  }
}

export interface FliunoRowSharedProps {
  result: FliunoCoreResult;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onExecute: (result: FliunoCoreResult) => void;
}

/** 悬浮窗（modal）列表行：listbox option，双行收紧 + size-7 图标容器。 */
export function ModalResultRow({
  result,
  index,
  selected,
  enabled,
  keybinding,
  disabledReason,
  showRecentHint,
  recentLabel,
  onSelect,
  onExecute,
}: FliunoRowSharedProps & {
  enabled: boolean;
  keybinding: string;
  disabledReason?: string;
  showRecentHint: boolean;
  recentLabel: string;
}) {
  return (
    <button
      type="button"
      role="option"
      id={result.id}
      data-fliuno-index={index}
      aria-selected={selected}
      disabled={!enabled}
      onMouseMove={onSelect}
      onClick={() => onExecute(result)}
      className={`group flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left transition-colors ${
        selected
          ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
          : "text-[var(--color-text-primary)] hover:bg-[var(--material-interactive-hover)]"
      } ${enabled ? "" : "cursor-not-allowed opacity-45"}`}
    >
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-lg ${
          result.kind === "command"
            ? "bg-[var(--material-panel)] text-[var(--color-text-muted)]"
            : "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
        }`}
      >
        <ResultIcon kind={result.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">
            <HighlightedText text={result.title} ranges={result.titleRanges} />
          </span>
          {showRecentHint && (
            <span className="shrink-0 text-[8px] text-[var(--color-text-muted)]">
              {recentLabel}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-[var(--color-text-muted)]">
          <HighlightedText text={result.description} ranges={result.descriptionRanges} />
        </span>
      </span>
      {!enabled && disabledReason && (
        <span className="max-w-44 truncate text-[9px] text-[var(--color-text-muted)]">
          {disabledReason}
        </span>
      )}
      {keybinding && (
        <kbd className="rounded-md border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-text-muted)]">
          {keybinding}
        </kbd>
      )}
      <Icons.ArrowRight
        size={13}
        className={`shrink-0 text-[var(--color-text-muted)] transition-opacity ${
          selected ? "opacity-80" : "opacity-0"
        }`}
      />
    </button>
  );
}

/** 工作区页结果卡：侧栏紧凑单行 / 页面双行卡片。 */
export function PageResultCard({
  result,
  index,
  selected,
  compact,
  onSelect,
  onExecute,
}: FliunoRowSharedProps & { compact: boolean }) {
  if (compact) {
    return (
      <button
        type="button"
        data-result-id={result.id}
        data-fliuno-index={index}
        onClick={() => onExecute(result)}
        onMouseMove={onSelect}
        className={`flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors ${
          selected
            ? "border-transparent bg-[var(--material-interactive-active)]"
            : "border-transparent hover:bg-[var(--material-interactive-hover)]"
        }`}
      >
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-lg ${
            result.kind === "command"
              ? "bg-[var(--material-panel)] text-[var(--color-text-muted)]"
              : "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
          }`}
        >
          <ResultIcon kind={result.kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium">
            <HighlightedText text={result.title} ranges={result.titleRanges} />
          </span>
          <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
            <HighlightedText text={result.description} ranges={result.descriptionRanges} />
          </span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      data-result-id={result.id}
      data-fliuno-index={index}
      onClick={() => onExecute(result)}
      onMouseMove={onSelect}
      className={`flex min-h-[72px] flex-col justify-between gap-2 rounded-xl border p-3 text-left transition-all ${
        selected
          ? "border-transparent bg-[var(--material-interactive-active)]"
          : "border-[var(--border-subtle)] bg-[var(--material-surface)] hover:border-[var(--border-overlay)] hover:bg-[var(--material-interactive-hover)]"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-lg ${
            result.kind === "command"
              ? "bg-[var(--material-panel)] text-[var(--color-text-muted)]"
              : "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
          }`}
        >
          <ResultIcon kind={result.kind} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
          <HighlightedText text={result.title} ranges={result.titleRanges} />
        </span>
      </span>
      <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
        <HighlightedText text={result.description} ranges={result.descriptionRanges} />
      </span>
    </button>
  );
}

/** 工作区页内容行：行号 + 命中行文本。 */
export function FliunoContentRow({
  result,
  index,
  selected,
  onSelect,
  onExecute,
}: FliunoRowSharedProps) {
  return (
    <button
      type="button"
      data-result-id={result.id}
      data-fliuno-index={index}
      onClick={() => onExecute(result)}
      onMouseMove={onSelect}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
        selected
          ? "bg-[var(--material-interactive-active)]"
          : "hover:bg-[var(--material-interactive-hover)]"
      }`}
    >
      <span className="w-10 shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
        {result.targetLine}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px]">
        <HighlightedText text={result.description} ranges={result.descriptionRanges} />
      </span>
    </button>
  );
}
