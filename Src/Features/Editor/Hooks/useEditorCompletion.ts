import { type RefObject, useMemo, useRef, useState } from "react";
import type { LanguageFeaturePreferences } from "../../../Foundation/Types/Config";
import { type EditorLayoutMetrics, measureEditorText } from "../Utils/EditorLayoutMetrics";
import { useEditorAutocomplete } from "./useEditorAutocomplete";
import { useEditorHover } from "./useEditorHover";

type TriggerAutocomplete = (
  lines: string[],
  lineIndex: number,
  charIndex: number,
  manual?: boolean,
) => void;

export interface UseEditorCompletionParams {
  path?: string;
  language: string;
  layout: EditorLayoutMetrics;
  languagePreferences: Required<LanguageFeaturePreferences>;
  containerRef: RefObject<HTMLDivElement | null>;
  scrollTop: number;
  documentLines: string[];
  cursor: { line: number; char: number };
  replaceDocumentLines: (
    nextLines: string[],
    nextCursor: { line: number; char: number },
    nextSelection?: SelectionRangeLike | null,
  ) => void;
  /** 经 ref 注入：useEditorCommit 在本 hook 之前装配，需要延迟绑定的补全触发器 */
  triggerAutocompleteRef: RefObject<TriggerAutocomplete>;
}

type SelectionRangeLike = {
  start: { line: number; char: number };
  end: { line: number; char: number };
};

/** Hover 提示与自动补全：交互阻断状态、候选锚点测量与补全面板装配。 */
export function useEditorCompletion({
  path,
  language,
  layout,
  languagePreferences,
  containerRef,
  scrollTop,
  documentLines,
  cursor,
  replaceDocumentLines,
  triggerAutocompleteRef,
}: UseEditorCompletionParams) {
  const isDraggingPointerRef = useRef(false);
  const [isContextMenuOpen, setHoverContextMenuOpen] = useState(false);
  const {
    tooltip: hoverTooltip,
    setVisibleTooltip: setVisibleHover,
    requestLanguageHover,
    handleLineMouseLeave,
    handleTooltipMouseEnter: handleHoverEnter,
    handleTooltipMouseLeave: handleHoverLeave,
    dismiss: dismissHover,
  } = useEditorHover({
    path,
    language,
    preferences: languagePreferences,
    interactionBlocked: () => isDraggingPointerRef.current || isContextMenuOpen,
  });

  const singleCharWidth = useMemo(() => measureEditorText("M", layout), [layout]);
  // 候选框锚点：按实际前缀文本测量，宽字符/CJK 不再漂移（textarea 代理与补全面板共用）
  const caretPos = useMemo(
    () => ({
      x:
        layout.contentInsetX +
        measureEditorText((documentLines[cursor.line] || "").substring(0, cursor.char), layout),
      y: layout.contentInsetTop + cursor.line * layout.lineHeight,
    }),
    [cursor.char, cursor.line, documentLines, layout.contentInsetTop, layout.contentInsetX, layout],
  );

  const {
    completions,
    completionIndex,
    completionPos,
    setCompletionIndex,
    setCompletions,
    closeAutocomplete,
    triggerAutocomplete,
    handleAutocompleteSelect,
  } = useEditorAutocomplete({
    path,
    language,
    layout,
    languagePreferences,
    containerRef,
    caretPos,
    scrollTop,
    documentLines,
    cursor,
    replaceDocumentLines,
    setVisibleHover,
  });
  triggerAutocompleteRef.current = triggerAutocomplete;

  return {
    isDraggingPointerRef,
    isContextMenuOpen,
    setHoverContextMenuOpen,
    hoverTooltip,
    setVisibleHover,
    requestLanguageHover,
    handleLineMouseLeave,
    handleHoverEnter,
    handleHoverLeave,
    dismissHover,
    singleCharWidth,
    caretPos,
    completions,
    completionIndex,
    completionPos,
    setCompletionIndex,
    setCompletions,
    closeAutocomplete,
    triggerAutocomplete,
    handleAutocompleteSelect,
  };
}
