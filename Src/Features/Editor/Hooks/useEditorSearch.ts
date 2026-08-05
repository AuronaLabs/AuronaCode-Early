import { useCallback, useEffect, useState } from "react";

export interface EditorSearchMatch {
  line: number;
  char: number;
}

export function findEditorMatches(lines: readonly string[], query: string): EditorSearchMatch[] {
  if (!query) return [];
  const loweredQuery = query.toLowerCase();
  const matches: EditorSearchMatch[] = [];
  lines.forEach((lineText, lineIndex) => {
    const lowered = lineText.toLowerCase();
    let index = lowered.indexOf(loweredQuery);
    while (index !== -1) {
      matches.push({ line: lineIndex, char: index });
      index = lowered.indexOf(loweredQuery, index + loweredQuery.length);
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
  const [matches, setMatches] = useState<EditorSearchMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!query) {
      setMatches([]);
      return;
    }
    setMatches(findEditorMatches(lines, query));
    setCurrentIndex(0);
  }, [lines, query]);

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
    matches,
    currentIndex,
    next,
    prev,
    close,
  };
}
