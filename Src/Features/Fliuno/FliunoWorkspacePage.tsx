import { useEffect, useMemo, useRef } from "react";
import { type FliunoCoreResult, parseFliunoQuery } from "../../Core/Fliuno/FliunoCore";
import {
  flattenFliunoPresentation,
  SECTION_LABEL_KEYS,
  SECTION_ORDER,
} from "../../Core/Fliuno/presentation";
import { useLocale } from "../../Foundation/I18n";
import { EmptyState } from "../../UI/Components/EmptyState";
import { Icons } from "../../UI/Icons/IconManager";
import {
  FliunoContentRow,
  FliunoGroupHeader,
  PageResultCard,
} from "./components/FliunoResultGroups";
import { FliunoScopeRow } from "./components/FliunoScopeRow";
import { FliunoSearchRow } from "./components/FliunoSearchRow";
import { useFliunoActiveScroll, useFliunoKeyboard } from "./components/useFliunoKeyboard";
import { executeFliunoResult, useFliunoSearch } from "./components/useFliunoSearch";

const FLIUNO_WORKSPACE_COMMAND_ID = "workbench.action.openFliunoWorkspace";

export function FliunoWorkspacePage({
  variant = "page",
}: {
  /** page: 编辑区整页；sidebar: 左侧侧边栏紧凑卡片 */
  variant?: "page" | "sidebar";
}) {
  const { t } = useLocale();
  const compact = variant === "sidebar";
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const search = useFliunoSearch({
    enabled: true,
    excludedCommandId: FLIUNO_WORKSPACE_COMMAND_ID,
  });
  const {
    query,
    setQuery,
    results,
    selectedIndex,
    setSelectedIndex,
    contentCaseSensitive,
    toggleCaseSensitive,
    contentRegex,
    toggleRegex,
    fileIndexState,
    pushRecentCommand,
    pushRecentFile,
    selectScope,
  } = search;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const parsed = parseFliunoQuery(query, search.scope);

  /**
   * 展示顺序 = 键盘导航顺序 = Enter 执行顺序。
   * displayResults 按可视分组顺序拍平：命令/文件/设置/符号，内容按文件分组。
   */
  const presentation = useMemo(() => flattenFliunoPresentation(results), [results]);

  const grouped = useMemo(
    () =>
      SECTION_ORDER.map((kind) => ({
        kind,
        items: presentation.display.filter((result) => result.kind === kind),
      })).filter((group) => group.items.length > 0),
    [presentation.display],
  );

  const execute = (result: FliunoCoreResult) => {
    executeFliunoResult(result, { command: pushRecentCommand, file: pushRecentFile });
  };

  const executeSelected = () => {
    const selected = presentation.display[selectedIndex];
    if (selected) execute(selected);
  };

  const handleKeyDown = useFliunoKeyboard({
    itemCount: presentation.display.length,
    scope: search.scope,
    pageSize: 12,
    setSelectedIndex,
    onScopeSelect: selectScope,
    onExecuteSelected: executeSelected,
  });

  useFliunoActiveScroll(resultsRef, selectedIndex);

  return (
    <div
      className={
        compact
          ? "flex h-full min-h-0 flex-col gap-2.5 bg-transparent px-3 pb-2.5 pt-3"
          : "flex h-full min-h-0 flex-col gap-3 bg-transparent px-6 pb-3 pt-4"
      }
    >
      <FliunoSearchRow
        variant={compact ? "sm" : "md"}
        query={query}
        inputRef={inputRef}
        onQueryChange={(value) => {
          setQuery(value);
          setSelectedIndex(-1);
        }}
        onClear={() => {
          setQuery("");
          setSelectedIndex(-1);
          inputRef.current?.focus();
        }}
        onKeyDown={handleKeyDown}
        placeholder={t("fliuno.workspacePlaceholder")}
      />

      <div className={compact ? "shrink-0 px-1" : "shrink-0 px-1"}>
        <FliunoScopeRow
          size={compact ? "sm" : "md"}
          scope={parsed.scope}
          onScopeChange={selectScope}
          caseSensitive={contentCaseSensitive}
          onToggleCaseSensitive={toggleCaseSensitive}
          regex={contentRegex}
          onToggleRegex={toggleRegex}
          count={presentation.display.length}
          indexing={fileIndexState === "loading"}
        />
      </div>

      <div ref={resultsRef} className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 aurona-scroll">
        {!search.workspaceRoot && (query || parsed.scope !== "commands") ? (
          <EmptyState
            className={compact ? "min-h-[160px]" : "min-h-[240px]"}
            icon={<Icons.Search size={24} stroke={1.5} />}
            title={t("fliuno.noWorkspace")}
          />
        ) : grouped.length ? (
          <div className={compact ? "flex flex-col gap-3" : "flex flex-col gap-6"}>
            {grouped.map((group) => {
              if (group.kind === "content") {
                return (
                  <section key={group.kind}>
                    <div className="flex flex-col gap-2.5">
                      {presentation.contentGroups.map((fileGroup) => (
                        <div
                          key={fileGroup.path}
                          className="overflow-hidden rounded-surface border border-[var(--border-subtle)] bg-[var(--material-surface)]"
                        >
                          <div className="truncate border-b border-[var(--border-subtle)] px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                            {fileGroup.path}
                          </div>
                          {fileGroup.items.map((result) => {
                            const displayIndex = presentation.indexById.get(result.id) ?? 0;
                            return (
                              <FliunoContentRow
                                key={result.id}
                                result={result}
                                index={displayIndex}
                                selected={displayIndex === selectedIndex}
                                onSelect={() => setSelectedIndex(displayIndex)}
                                onExecute={execute}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              }
              return (
                <section key={group.kind}>
                  <FliunoGroupHeader className={compact ? "-mx-1 px-1 py-1" : "mb-1.5 px-1 py-1.5"}>
                    {t(SECTION_LABEL_KEYS[group.kind])}
                  </FliunoGroupHeader>
                  <div
                    className={
                      compact
                        ? "flex flex-col gap-1"
                        : "grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
                    }
                  >
                    {group.items.map((result) => {
                      const displayIndex = presentation.indexById.get(result.id) ?? 0;
                      return (
                        <PageResultCard
                          key={result.id}
                          result={result}
                          index={displayIndex}
                          selected={displayIndex === selectedIndex}
                          compact={compact}
                          onSelect={() => setSelectedIndex(displayIndex)}
                          onExecute={execute}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <EmptyState
            className={compact ? "min-h-[160px]" : "min-h-[240px]"}
            icon={<Icons.Search size={24} stroke={1.5} />}
            title={query ? t("common.noResults") : t("fliuno.emptyHint")}
          />
        )}
      </div>

      {!compact && (
        <footer className="flex shrink-0 items-center gap-4 px-1 text-[9px] text-[var(--color-text-muted)]/75">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--border-subtle)] px-1 py-0.5">↑↓</kbd>
            {t("common.search")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--border-subtle)] px-1 py-0.5">Enter</kbd>
            {t("common.open")}
          </span>
          <span className="ml-auto flex items-center gap-2 opacity-80">
            <span>
              {">"} {t("common.command")}
            </span>
            <span>
              {"@"} {t("common.file")}
            </span>
            <span>
              {"#"} {t("common.symbol")}
            </span>
            <span>
              {"!"} {t("extensions.sidebarTitle")}
            </span>
            <span>
              {":"} {t("common.content")}
            </span>
          </span>
        </footer>
      )}
    </div>
  );
}
