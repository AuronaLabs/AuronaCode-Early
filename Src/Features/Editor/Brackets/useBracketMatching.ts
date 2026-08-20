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

  // 2. 匹配当前光标邻近的括号
  const activeMatchedPair = useMemo(() => {
    const { line, char } = cursor;
    // 检查光标左侧或右侧的字符是否为括号
    for (const pair of pairs) {
      if (
        (pair.open.line === line && (pair.open.char === char || pair.open.char === char - 1)) ||
        (pair.close.line === line && (pair.close.char === char || pair.close.char === char - 1))
      ) {
        return pair;
      }
    }
    return null;
  }, [cursor, pairs]);

  return {
    lineBrackets,
    pairs,
    activeMatchedPair,
  };
}
