import { useCallback, useEffect, useState } from "react";

export interface EditorSearchOptions {
  /** 区分大小写 */
  matchCase: boolean;
  /** 全字匹配 */
  wholeWord: boolean;
  /** 使用正则表达式 */
  useRegex: boolean;
}

export const defaultSearchOptions: EditorSearchOptions = {
  matchCase: false,
  wholeWord: false,
  useRegex: false,
};

export interface EditorSearchMatch {
  line: number;
  char: number;
  /** UTF-16 命中长度：字面量搜索等于 query.length，正则搜索逐命中可变 */
  length: number;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 依据选项构造全局正则；字面量查询自动转义。无效正则返回 null，由 UI 提示。 */
export function buildSearchRegex(
  query: string,
  options: EditorSearchOptions = defaultSearchOptions,
): RegExp | null {
  if (!query) return null;
  let pattern = options.useRegex ? query : escapeRegExp(query);
  if (options.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  try {
    return new RegExp(pattern, options.matchCase ? "gu" : "giu");
  } catch {
    return null;
  }
}

export function findEditorMatches(
  lines: readonly string[],
  query: string,
  options: EditorSearchOptions = defaultSearchOptions,
): EditorSearchMatch[] {
  const regex = buildSearchRegex(query, options);
  if (!regex) return [];
  const matches: EditorSearchMatch[] = [];
  lines.forEach((lineText, lineIndex) => {
    regex.lastIndex = 0;
    let hit = regex.exec(lineText);
    while (hit !== null) {
      if (hit[0].length > 0) {
        matches.push({ line: lineIndex, char: hit.index, length: hit[0].length });
      } else {
        // 空匹配（如 ^）无法高亮：前进一步避免死循环
        regex.lastIndex += 1;
      }
      hit = regex.exec(lineText);
    }
  });
  return matches;
}

export function advanceMatchIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + direction + total) % total;
}

export function useEditorSearch(
  lines: readonly string[],
  onScrollToMatch: (match: EditorSearchMatch) => void,
) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<EditorSearchOptions>(defaultSearchOptions);
  const [matches, setMatches] = useState<EditorSearchMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!query) {
      setMatches([]);
      return;
    }
    setMatches(findEditorMatches(lines, query, options));
    setCurrentIndex(0);
  }, [lines, query, options]);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    const index = advanceMatchIndex(currentIndex, matches.length, 1);
    setCurrentIndex(index);
    onScrollToMatch(matches[index]);
  }, [currentIndex, matches, onScrollToMatch]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    const index = advanceMatchIndex(currentIndex, matches.length, -1);
    setCurrentIndex(index);
    onScrollToMatch(matches[index]);
  }, [currentIndex, matches, onScrollToMatch]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setMatches([]);
  }, []);

  return {
    isOpen,
    setIsOpen,
    query,
    setQuery,
    options,
    setOptions,
    matches,
    currentIndex,
    next,
    prev,
    close,
  };
}
