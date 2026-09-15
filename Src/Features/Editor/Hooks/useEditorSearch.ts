import { useCallback, useEffect, useRef, useState } from "react";

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

/** 单次搜索的最大匹配数：防止大文件宽匹配生成海量结果拖垮渲染 */
export const MAX_SEARCH_MATCHES = 50_000;

export function findEditorMatches(
  lines: readonly string[],
  query: string,
  options: EditorSearchOptions = defaultSearchOptions,
): EditorSearchMatch[] {
  const regex = buildSearchRegex(query, options);
  if (!regex) return [];
  const matches: EditorSearchMatch[] = [];
  lines.forEach((lineText, lineIndex) => {
    if (matches.length >= MAX_SEARCH_MATCHES) return;
    regex.lastIndex = 0;
    let hit = regex.exec(lineText);
    while (hit !== null) {
      if (hit[0].length > 0) {
        matches.push({ line: lineIndex, char: hit.index, length: hit[0].length });
      } else {
        // 空匹配（如 ^）无法高亮：前进一步避免死循环
        regex.lastIndex += 1;
      }
      if (matches.length >= MAX_SEARCH_MATCHES) return;
      hit = regex.exec(lineText);
    }
  });
  return matches;
}

export function advanceMatchIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + direction + total) % total;
}

/**
 * 展开正则替换串：$1..$99 捕获组、$& 整个匹配、$$ 字面量 $。
 * 字面量模式原样返回；无效组号保留原 token。
 */
export function expandRegexReplacement(
  replaceValue: string,
  match: RegExpExecArray,
  useRegex: boolean,
): string {
  if (!useRegex) return replaceValue;
  return replaceValue.replace(/\$(\$|&|\d{1,2})/g, (token, group: string) => {
    if (group === "$") return "$";
    if (group === "&") return match[0];
    const index = Number(group);
    return index > 0 && index < match.length ? (match[index] ?? "") : token;
  });
}

/**
 * 计算单行中某命中替换后的实际插入文本（正则模式按该命中展开捕获组）。
 */
export function resolveLineReplacement(
  lineText: string,
  match: EditorSearchMatch,
  query: string,
  replaceValue: string,
  options: EditorSearchOptions,
): string {
  if (!options.useRegex) return replaceValue;
  const regex = buildSearchRegex(query, options);
  if (!regex) return replaceValue;
  const sticky = new RegExp(regex.source, `${regex.flags.replace("g", "")}y`);
  sticky.lastIndex = match.char;
  const hit = sticky.exec(lineText);
  return hit ? expandRegexReplacement(replaceValue, hit, true) : replaceValue;
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
  // 替换当前后，重算匹配时跳到替换点之后第一个命中，而非回 0
  const replacementAnchorRef = useRef<{ line: number; anchorChar: number } | null>(null);

  /** 标记替换锚点：line 行中替换起点 + 新文本长度（替换后继续搜索的位置） */
  const markReplacementAnchor = useCallback((line: number, anchorChar: number) => {
    replacementAnchorRef.current = { line, anchorChar };
  }, []);

  useEffect(() => {
    if (!query) {
      setMatches([]);
      return;
    }
    const nextMatches = findEditorMatches(lines, query, options);
    setMatches(nextMatches);
    const anchor = replacementAnchorRef.current;
    replacementAnchorRef.current = null;
    if (anchor) {
      const index = nextMatches.findIndex(
        (m) => m.line > anchor.line || (m.line === anchor.line && m.char >= anchor.anchorChar),
      );
      const resolved = index >= 0 ? index : 0;
      setCurrentIndex(resolved);
      if (nextMatches[resolved]) onScrollToMatch(nextMatches[resolved]);
      return;
    }
    setCurrentIndex(0);
  }, [lines, query, options, onScrollToMatch]);

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
    markReplacementAnchor,
    next,
    prev,
    close,
  };
}
