import { useCallback, useState } from "react";
import { sortSelection } from "../Utils/EditorMath";
import {
  buildSearchRegex,
  type EditorSearchMatch,
  resolveLineReplacement,
  useEditorSearch,
} from "./useEditorSearch";
import type { SelectionRange } from "./useEditorSelectionOps";

export interface UseEditorSearchReplaceParams {
  documentLines: string[];
  cursor: { line: number; char: number };
  selection: SelectionRange | null;
  /** 统一编辑提交点（useEditorCommit 返回值） */
  commitEdit: (
    nextLines: string[],
    nextCursor: { line: number; char: number },
    nextSelection?: SelectionRange | null,
  ) => void;
  setCursor: (cursor: { line: number; char: number }) => void;
  setSelection: React.Dispatch<React.SetStateAction<SelectionRange | null>>;
  scrollToLine: (line: number) => void;
}

/** 搜索与替换：Ctrl+F 选区预填、替换当前/全部（与 undo/redo 相同的落盘与同步路径）。 */
export function useEditorSearchReplace({
  documentLines,
  cursor,
  selection,
  commitEdit,
  setCursor,
  setSelection,
  scrollToLine,
}: UseEditorSearchReplaceParams) {
  const onScrollToMatch = useCallback(
    (match: EditorSearchMatch) => {
      setCursor(match);
      setSelection({ start: match, end: { line: match.line, char: match.char + 1 } });
      scrollToLine(match.line);
    },
    [scrollToLine, setCursor, setSelection],
  );

  const {
    isOpen: isSearchOpen,
    query: searchQuery,
    options: searchOptions,
    setOptions: setSearchOptions,
    matches: searchMatches,
    currentIndex: currentMatchIndex,
    setIsOpen: setIsSearchOpenState,
    setQuery: setSearchQuery,
    markReplacementAnchor,
    next: handleSearchNext,
    prev: handleSearchPrev,
    close: handleSearchClose,
  } = useEditorSearch(documentLines, onScrollToMatch);

  // 搜索替换：与 undo/redo 相同的落盘与同步路径
  const [replaceValue, setReplaceValue] = useState("");
  // Ctrl+F 打开搜索时预填当前选区文本（仅单行选区；无选区则置空）
  const [searchSeed, setSearchSeed] = useState("");
  const invalidSearchQuery =
    searchQuery !== "" && buildSearchRegex(searchQuery, searchOptions) === null;

  // 打开搜索时捕获选区文本作为预填种子
  const setIsSearchOpen = useCallback(
    (open: boolean) => {
      if (open && selection) {
        const { start, end } = sortSelection(selection);
        setSearchSeed(
          start.line === end.line
            ? (documentLines[start.line] || "").slice(start.char, end.char)
            : "",
        );
      }
      setIsSearchOpenState(open);
    },
    [documentLines, selection, setIsSearchOpenState],
  );

  const applyReplacedContent = useCallback(
    (nextContent: string) => {
      const nextLines = nextContent.split("\n");
      commitEdit(nextLines, cursor, selection);
    },
    [commitEdit, cursor, selection],
  );

  const handleReplaceCurrent = useCallback(() => {
    const match = searchMatches[currentMatchIndex];
    if (!match) return;
    const line = documentLines[match.line] ?? "";
    const replacement = resolveLineReplacement(
      line,
      match,
      searchQuery,
      replaceValue,
      searchOptions,
    );
    const nextLine =
      line.slice(0, match.char) + replacement + line.slice(match.char + match.length);
    const nextLines = [...documentLines];
    nextLines[match.line] = nextLine;
    // 替换后继续搜索的位置：替换起点 + 新文本长度
    markReplacementAnchor(match.line, match.char + replacement.length);
    applyReplacedContent(nextLines.join("\n"));
  }, [
    applyReplacedContent,
    currentMatchIndex,
    documentLines,
    markReplacementAnchor,
    replaceValue,
    searchOptions,
    searchQuery,
    searchMatches,
  ]);

  const handleReplaceAll = useCallback(() => {
    if (searchMatches.length === 0) return;
    // 命中按 (line, char) 升序：逐行从后向前替换，保持索引稳定；正则替换逐命中展开捕获组
    const nextLines = documentLines.map((line, lineIndex) => {
      const lineMatches = searchMatches.filter((m) => m.line === lineIndex);
      if (lineMatches.length === 0) return line;
      let result = line;
      for (let i = lineMatches.length - 1; i >= 0; i--) {
        const match = lineMatches[i];
        const replacement = resolveLineReplacement(
          line,
          match,
          searchQuery,
          replaceValue,
          searchOptions,
        );
        result =
          result.slice(0, match.char) + replacement + result.slice(match.char + match.length);
      }
      return result;
    });
    applyReplacedContent(nextLines.join("\n"));
  }, [
    applyReplacedContent,
    documentLines,
    replaceValue,
    searchMatches,
    searchOptions,
    searchQuery,
  ]);

  return {
    isSearchOpen,
    searchQuery,
    searchOptions,
    setSearchOptions,
    searchMatches,
    currentMatchIndex,
    setIsSearchOpen,
    setSearchQuery,
    handleSearchNext,
    handleSearchPrev,
    handleSearchClose,
    replaceValue,
    setReplaceValue,
    searchSeed,
    invalidSearchQuery,
    handleReplaceCurrent,
    handleReplaceAll,
  };
}
