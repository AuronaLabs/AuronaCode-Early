import { type KeyboardEvent, type RefObject, useCallback, useEffect } from "react";
import type { FliunoScope } from "../../../Core/Fliuno/FliunoCore";
import { FLIUNO_SCOPE_OPTIONS } from "./scopeOptions";

export interface UseFliunoKeyboardOptions {
  itemCount: number;
  scope: FliunoScope;
  /** PageUp/PageDown 步长：列表 10，网格页 12 */
  pageSize?: number;
  setSelectedIndex: (update: number | ((prev: number) => number)) => void;
  onScopeSelect: (scope: FliunoScope) => void;
  onExecuteSelected: () => void;
  onEscape?: () => void;
}

/**
 * Modal 与工作区页共用的键盘导航：↑↓/Home/End/PageUp/PageDown/Tab 循环 scope/
 * Enter 执行。选中索引即「可视展示顺序」（flattenFliunoPresentation 拍平序）。
 */
export function useFliunoKeyboard({
  itemCount,
  scope,
  pageSize = 10,
  setSelectedIndex,
  onScopeSelect,
  onExecuteSelected,
  onEscape,
}: UseFliunoKeyboardOptions) {
  return useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        onEscape?.();
        return;
      }
      if (!itemCount) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const offset = event.key === "ArrowDown" ? 1 : -1;
        setSelectedIndex((index) => {
          if (index < 0) return offset > 0 ? 0 : -1;
          return Math.min(Math.max(index + offset, 0), itemCount - 1);
        });
        return;
      }
      if (
        event.key === "PageDown" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        event.key === "End"
      ) {
        event.preventDefault();
        setSelectedIndex((index) => {
          const base = index < 0 ? 0 : index;
          if (event.key === "Home") return 0;
          if (event.key === "End") return itemCount - 1;
          if (event.key === "PageUp") return Math.max(0, base - pageSize);
          return Math.min(itemCount - 1, base + pageSize);
        });
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const index = FLIUNO_SCOPE_OPTIONS.findIndex((option) => option.id === scope);
        const next =
          FLIUNO_SCOPE_OPTIONS[
            (index + (event.shiftKey ? -1 : 1) + FLIUNO_SCOPE_OPTIONS.length) %
              FLIUNO_SCOPE_OPTIONS.length
          ].id;
        onScopeSelect(next);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onExecuteSelected();
      }
    },
    [itemCount, onEscape, onExecuteSelected, onScopeSelect, pageSize, scope, setSelectedIndex],
  );
}

/** 选中项变化时滚动到可视区（行元素统一挂 data-fliuno-index）。 */
export function useFliunoActiveScroll(
  containerRef: RefObject<HTMLElement | null>,
  selectedIndex: number,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container
      .querySelector<HTMLElement>(`[data-fliuno-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [containerRef, selectedIndex]);
}
