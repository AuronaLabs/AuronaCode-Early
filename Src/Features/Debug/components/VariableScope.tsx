import { useState } from "react";
import { DebugService } from "../../../Core/DebugService";
import { useLocale } from "../../../Foundation/I18n";
import type { DebugVariable } from "../../../State/useDebugStore";
import { Icons } from "../../../UI/Icons/IconManager";

/** 单个作用域（Scopes/ Locals 等）的变量树：展开懒加载 + 变更高亮 + 复制表达式/值。 */
export function VariableScope({
  name,
  variables,
  variablesByReference,
  loadingReferences,
  changedVariables,
  variablePagination,
}: {
  name: string;
  variables: DebugVariable[];
  variablesByReference: Record<number, DebugVariable[]>;
  loadingReferences: number[];
  changedVariables: string[];
  variablePagination: Record<number, { nextStart: number; hasMore: boolean }>;
}) {
  const [expandedReferences, setExpandedReferences] = useState<Set<number>>(() => new Set());
  const toggleReference = (reference: number) => {
    setExpandedReferences((current) => {
      const next = new Set(current);
      if (next.has(reference)) next.delete(reference);
      else next.add(reference);
      return next;
    });
    void DebugService.loadVariables(reference);
  };

  return (
    <div className="overflow-hidden rounded-lg bg-[var(--material-panel)]">
      <div className="flex h-7 items-center gap-2 px-2.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
        <Icons.ChevronRight size={11} className="rotate-90" />
        <span className="truncate">{name}</span>
        <span className="ml-auto font-normal">{variables.length}</span>
      </div>
      <div className="pb-1">
        {variables.map((variable) => (
          <VariableRow
            key={`${variable.evaluateName ?? variable.name}-${variable.value}-${variable.variablesReference}`}
            variable={variable}
            depth={0}
            variablesByReference={variablesByReference}
            loadingReferences={loadingReferences}
            expandedReferences={expandedReferences}
            changed={changedVariables.includes(`${name}.${variable.evaluateName ?? variable.name}`)}
            pagination={variablePagination[variable.variablesReference]}
            totalHint={variable.namedVariables ?? variable.indexedVariables}
            variablePagination={variablePagination}
            onToggle={toggleReference}
          />
        ))}
      </div>
    </div>
  );
}

function VariableRow({
  variable,
  depth,
  variablesByReference,
  loadingReferences,
  expandedReferences,
  changed,
  pagination,
  totalHint,
  variablePagination,
  onToggle,
}: {
  variable: DebugVariable;
  depth: number;
  variablesByReference: Record<number, DebugVariable[]>;
  loadingReferences: number[];
  expandedReferences: Set<number>;
  changed: boolean;
  pagination?: { nextStart: number; hasMore: boolean };
  totalHint?: number;
  variablePagination: Record<number, { nextStart: number; hasMore: boolean }>;
  onToggle: (reference: number) => void;
}) {
  const { t } = useLocale();
  const expandable = variable.variablesReference > 0;
  const expanded = expandable && expandedReferences.has(variable.variablesReference);
  const loading = loadingReferences.includes(variable.variablesReference);
  const children = variablesByReference[variable.variablesReference] ?? [];
  return (
    <>
      <div
        className="group grid h-7 w-full min-w-0 grid-cols-[minmax(70px,0.8fr)_minmax(0,1.2fr)_auto] items-center gap-1 rounded-md pr-1 text-left text-[10px] hover:bg-[var(--material-interactive-hover)]"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <button
          type="button"
          className="flex h-7 min-w-0 items-center gap-1 disabled:cursor-default"
          disabled={!expandable}
          onClick={() => expandable && onToggle(variable.variablesReference)}
        >
          <span className="flex h-3 w-3 shrink-0 items-center justify-center text-[var(--color-text-muted)]">
            {expandable && (
              <Icons.ChevronRight
                size={10}
                className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            )}
          </span>
          <span className="truncate font-medium text-[var(--color-text-primary)]">
            {variable.name}
          </span>
        </button>
        <button
          type="button"
          className="flex h-7 min-w-0 items-center gap-1.5 disabled:cursor-default"
          disabled={!expandable}
          onClick={() => expandable && onToggle(variable.variablesReference)}
        >
          <span
            className={`truncate font-mono ${
              changed ? "text-[var(--StatusWarning)]" : "text-[var(--color-text-muted)]"
            }`}
          >
            {loading && expanded ? t("debug.loadingRead") : variable.value}
          </span>
          {variable.type && (
            <span className="shrink-0 text-[9px] text-[var(--color-text-muted)]/70">
              {variable.type}
            </span>
          )}
        </button>
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {variable.evaluateName && (
            <button
              type="button"
              aria-label={t("debug.copyExpression")}
              className="rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)]"
              onClick={() => void navigator.clipboard.writeText(variable.evaluateName as string)}
            >
              <Icons.Copy size={10} />
            </button>
          )}
          <button
            type="button"
            aria-label={t("debug.copyValue")}
            className="rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)]"
            onClick={() => void navigator.clipboard.writeText(variable.value)}
          >
            <Icons.Copy size={10} />
          </button>
        </span>
      </div>
      {expanded &&
        children.map((child) => (
          <VariableRow
            key={`${variable.variablesReference}-${child.evaluateName ?? child.name}-${child.value}-${child.variablesReference}`}
            variable={child}
            depth={depth + 1}
            variablesByReference={variablesByReference}
            loadingReferences={loadingReferences}
            expandedReferences={expandedReferences}
            changed={false}
            pagination={variablePagination[child.variablesReference]}
            totalHint={child.namedVariables ?? child.indexedVariables}
            variablePagination={variablePagination}
            onToggle={onToggle}
          />
        ))}
      {expanded && pagination?.hasMore && (
        <button
          type="button"
          className="rounded-md py-1 pr-2 text-[9px] text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
          style={{ paddingLeft: `${18 + depth * 14}px` }}
          onClick={() =>
            void DebugService.loadVariables(
              variable.variablesReference,
              pagination.nextStart,
              totalHint,
            )
          }
        >
          {t("debug.loadMore")}
        </button>
      )}
    </>
  );
}
