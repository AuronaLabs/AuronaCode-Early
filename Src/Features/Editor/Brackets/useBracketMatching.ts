import { useMemo } from "react";

export interface BracketPair {
  open: { line: number; char: number; type: string };
  close: { line: number; char: number; type: string };
  level: number; // 0 ~ 5 (6 色彩虹)
}

export interface LineBracketToken {
  charIndex: number;
  type: "(" | ")" | "[" | "]" | "{" | "}";
  level: number;
  isOpen: boolean;
}

const BRACKET_CLOSE_TO_OPEN: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

/** 光标配对局部扫描窗口（主光标行向上/向下最多 500 行） */
export const BRACKET_SCAN_WINDOW_LINES = 500;

/**
 * 光标邻近括号配对：在主光标行上/下最多 windowLines 行的窗口内做括号栈匹配。
 * 纯函数（供测试）：只负责光标配对，彩虹层级全量计算仍由 hook 内 useMemo 承担。
 */
export function findMatchedPairNearCursor(
  documentLines: string[],
  cursor: { line: number; char: number },
  windowLines = BRACKET_SCAN_WINDOW_LINES,
): BracketPair | null {
  const { line, char } = cursor;
  const lineText = documentLines[line] || "";
  const isBracket = (ch: string | undefined) =>
    ch === "(" || ch === "[" || ch === "{" || ch === ")" || ch === "]" || ch === "}";
  // 光标下或光标左侧字符为括号才需要配对（与 VSCode 行为一致）
  if (!isBracket(lineText[char]) && !isBracket(lineText[char - 1])) return null;

  const startLine = Math.max(0, line - windowLines);
  const endLine = Math.min(documentLines.length - 1, line + windowLines);
  const stack: Array<{ line: number; char: number; type: string; level: number }> = [];
  const targetKeys = new Set([`${line}:${char}`, `${line}:${char - 1}`]);
  let matched: BracketPair | null = null;

  for (let l = startLine; l <= endLine && !matched; l++) {
    const text = documentLines[l] || "";
    for (let c = 0; c < text.length; c++) {
      const ch = text[c];
      if (ch === "(" || ch === "[" || ch === "{") {
        stack.push({ line: l, char: c, type: ch, level: stack.length % 6 });
      } else if (ch === ")" || ch === "]" || ch === "}") {
        const expectedOpen = BRACKET_CLOSE_TO_OPEN[ch];
        if (stack.length > 0 && stack[stack.length - 1].type === expectedOpen) {
          const openBracket = stack.pop();
          if (
            openBracket &&
            (targetKeys.has(`${openBracket.line}:${openBracket.char}`) ||
              targetKeys.has(`${l}:${c}`))
          ) {
            matched = {
              open: { line: openBracket.line, char: openBracket.char, type: openBracket.type },
              close: { line: l, char: c, type: ch },
              level: openBracket.level,
            };
            break;
          }
        }
      }
    }
  }
  return matched;
}

/**
 * 计算文档所有行括号彩虹层级及当前光标处配对括号
 */
export function useBracketMatching(
  documentLines: string[],
  cursor: { line: number; char: number },
) {
  // 1. 全文档开闭括号栈与层级计算
  const { lineBrackets, pairs } = useMemo(() => {
    const stack: Array<{ line: number; char: number; type: string; level: number }> = [];
    const lineBrackets = new Map<number, LineBracketToken[]>();
    const pairs: BracketPair[] = [];

    for (let l = 0; l < documentLines.length; l++) {
      const lineText = documentLines[l] || "";
      const lineTokens: LineBracketToken[] = [];

      for (let c = 0; c < lineText.length; c++) {
        const char = lineText[c];
        if (char === "(" || char === "[" || char === "{") {
          const level = stack.length % 6;
          stack.push({ line: l, char: c, type: char, level });
          lineTokens.push({ charIndex: c, type: char, level, isOpen: true });
        } else if (char === ")" || char === "]" || char === "}") {
          const expectedOpen = BRACKET_CLOSE_TO_OPEN[char];
          // 回溯匹配栈顶括号
          if (stack.length > 0 && stack[stack.length - 1].type === expectedOpen) {
            const openBracket = stack.pop();
            if (openBracket) {
              pairs.push({
                open: {
                  line: openBracket.line,
                  char: openBracket.char,
                  type: openBracket.type,
                },
                close: { line: l, char: c, type: char },
                level: openBracket.level,
              });
              lineTokens.push({
                charIndex: c,
                type: char,
                level: openBracket.level,
                isOpen: false,
              });
            }
          } else {
            // 孤立未闭合括号
            lineTokens.push({ charIndex: c, type: char, level: 0, isOpen: false });
          }
        }
      }

      if (lineTokens.length > 0) {
        lineBrackets.set(l, lineTokens);
      }
    }

    return { lineBrackets, pairs };
  }, [documentLines]);

  // 2. 匹配当前光标邻近的括号（局部扫描：窗口内栈匹配，替代全量 pairs 遍历）
  const activeMatchedPair = useMemo(
    () => findMatchedPairNearCursor(documentLines, cursor),
    [cursor, documentLines],
  );

  return {
    lineBrackets,
    pairs,
    activeMatchedPair,
  };
}
