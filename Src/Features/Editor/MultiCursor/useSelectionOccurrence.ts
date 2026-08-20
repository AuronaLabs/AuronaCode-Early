import { useMemo } from "react";
import type { SelectionRange } from "../Hooks/useEditorSelectionOps";

export interface OccurrenceMatch {
  line: number;
  startChar: number;
  endChar: number;
}

export function useSelectionOccurrence(
  documentLines: string[],
  selection: SelectionRange | null,
): OccurrenceMatch[] {
  return useMemo(() => {
    let targetWord = "";

    if (selection && selection.start.line === selection.end.line) {
      const lineText = documentLines[selection.start.line] || "";
      targetWord = lineText.substring(selection.start.char, selection.end.char).trim();
    }

    if (!targetWord || targetWord.length < 2 || targetWord.includes("\n")) {
      return [];
    }

    // 仅在合法标识符时进行全匹配
    if (!/^[\p{L}\p{N}_$]+$/u.test(targetWord)) {
      return [];
    }

    const occurrences: OccurrenceMatch[] = [];
    const targetLen = targetWord.length;

    for (let l = 0; l < documentLines.length; l++) {
      const lineText = documentLines[l] || "";
      let startIndex = 0;

      while (startIndex < lineText.length) {
        const found = lineText.indexOf(targetWord, startIndex);
        if (found === -1) break;

        // 单词全词匹配检查（前后不能是字母数字下划线）
        const prevChar = found > 0 ? lineText[found - 1] : "";
        const nextChar = found + targetLen < lineText.length ? lineText[found + targetLen] : "";
        const isWordBoundary =
          (!prevChar || !/[\p{L}\p{N}_$]/u.test(prevChar)) &&
          (!nextChar || !/[\p{L}\p{N}_$]/u.test(nextChar));

        if (isWordBoundary) {
          occurrences.push({
            line: l,
            startChar: found,
            endChar: found + targetLen,
          });
        }
        startIndex = found + targetLen;
      }
    }

    return occurrences;
  }, [documentLines, selection]);
}
