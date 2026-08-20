import { useCallback, useMemo, useState } from "react";
import { FoldingLineMap, type FoldRange } from "./FoldingLineMap";

export function useCodeFolding(documentLines: string[]) {
  const [foldedStartLines, setFoldedStartLines] = useState<Set<number>>(new Set());

  // 1. 基于缩进级别 (Indent Level) 识别所有可折叠的代码块区间
  const foldableRanges = useMemo(() => {
    const ranges: FoldRange[] = [];
    const stack: Array<{ line: number; indent: number }> = [];

    for (let l = 0; l < documentLines.length; l++) {
      const lineText = documentLines[l] || "";
      if (!lineText.trim()) continue; // 空行不作为缩进基准

      const indent = lineText.search(/\S/);
      if (indent === -1) continue;

      // 缩进减少，回溯闭合之前较深缩进的块
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        const top = stack.pop();
        if (top && l - 1 > top.line) {
          ranges.push({ startLine: top.line, endLine: l - 1 });
        }
      }

      // 检查当前行后一行是否缩进更深
      let nextNonEmptyLine = -1;
      let nextIndent = -1;
      for (let next = l + 1; next < documentLines.length; next++) {
        const nextText = documentLines[next] || "";
        if (nextText.trim()) {
          nextNonEmptyLine = next;
          nextIndent = nextText.search(/\S/);
          break;
        }
      }

      if (nextNonEmptyLine !== -1 && nextIndent > indent) {
        stack.push({ line: l, indent });
      }
    }

    // 处理文档末尾未闭合的块
    while (stack.length > 0) {
      const top = stack.pop();
      if (top && documentLines.length - 1 > top.line) {
        ranges.push({ startLine: top.line, endLine: documentLines.length - 1 });
      }
    }

    return ranges;
  }, [documentLines]);

  // 2. 当前处于折叠状态的完整区间列表
  const activeFoldedRanges = useMemo(() => {
    return foldableRanges.filter((r) => foldedStartLines.has(r.startLine));
  }, [foldableRanges, foldedStartLines]);

  // 3. 构建行号映射表
  const lineMap = useMemo(() => {
    return new FoldingLineMap(documentLines.length, activeFoldedRanges);
  }, [documentLines.length, activeFoldedRanges]);

  // 4. 切换指定行的折叠状态
  const toggleFold = useCallback(
    (line: number) => {
      const isFoldable = foldableRanges.some((r) => r.startLine === line);
      if (!isFoldable) return;

      setFoldedStartLines((prev) => {
        const next = new Set(prev);
        if (next.has(line)) {
          next.delete(line);
        } else {
          next.add(line);
        }
        return next;
      });
    },
    [foldableRanges],
  );

  // 5. 全部展开与全部折叠
  const unfoldAll = useCallback(() => {
    setFoldedStartLines(new Set());
  }, []);

  const foldAll = useCallback(() => {
    setFoldedStartLines(new Set(foldableRanges.map((r) => r.startLine)));
  }, [foldableRanges]);

  return {
    foldableRanges,
    foldedStartLines,
    activeFoldedRanges,
    lineMap,
    toggleFold,
    unfoldAll,
    foldAll,
  };
}
