import type React from "react";
import { useCallback } from "react";
import { LocaleService } from "../../../Foundation/I18n";
import type { LanguageFeaturePreferences } from "../../../Foundation/Types/Config";
import type { CompletionItem } from "../../../Foundation/Types/Lsp";
import { showToast } from "../../../UI/Feedback/Toast";
import {
  affectedLineRange,
  duplicateLineRange,
  indentLineRange,
  moveLineRange,
  outdentLineRange,
  toggleLineComment,
} from "../Utils/EditorLineOperations";
import { sortSelection } from "../Utils/EditorMath";
import { getLinesAfterDeletion, type SelectionRange } from "./useEditorSelectionOps";

const WORD_CHAR = /[\p{L}\p{N}_$]/u;
const AUTO_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};
const CLOSERS = new Set([")", "]", "}", '"', "'", "`"]);

/** 行内词边界跳转：向后跳到下一个词首，向前跳到上一个词首；无有效目标返回 null 由调用方跨行处理 */
function findWordJump(lineText: string, char: number, forward: boolean): number | null {
  if (forward) {
    if (char >= lineText.length) return null;
    let i = char;
    if (WORD_CHAR.test(lineText[i])) {
      while (i < lineText.length && WORD_CHAR.test(lineText[i])) i++;
    } else {
      while (i < lineText.length && !WORD_CHAR.test(lineText[i]) && /\S/.test(lineText[i])) i++;
    }
    while (i < lineText.length && (lineText[i] === " " || lineText[i] === "\t")) i++;
    return i;
  }
  if (char <= 0) return null;
  let i = char;
  while (i > 0 && /\s/.test(lineText[i - 1])) i--;
  if (i > 0 && WORD_CHAR.test(lineText[i - 1])) {
    while (i > 0 && WORD_CHAR.test(lineText[i - 1])) i--;
  } else {
    while (i > 0 && !WORD_CHAR.test(lineText[i - 1]) && /\S/.test(lineText[i - 1])) i--;
  }
  return i;
}

export interface UseEditorKeybindingsProps {
  language: string;
  documentLines: string[];
  cursor: { line: number; char: number };
  selection: SelectionRange | null;
  isComposing: boolean;
  completions: CompletionItem[];
  completionIndex: number;
  languagePreferences: Required<LanguageFeaturePreferences>;
  replaceDocumentLines: (
    nextLines: string[],
    nextCursor: { line: number; char: number },
    nextSelection?: SelectionRange | null,
  ) => void;
  insertTextAtCursor: (text: string) => void;
  executeSelectionDelete: () => void;
  moveCursor: (newLine: number, newChar: number, shift: boolean) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  triggerAutocomplete: (
    lines: string[],
    lineIndex: number,
    charIndex: number,
    manual?: boolean,
  ) => void;
  handleAutocompleteSelect: (index: number) => void;
  setCompletions: (items: CompletionItem[]) => void;
  setCompletionIndex: React.Dispatch<React.SetStateAction<number>>;
  setSelection: React.Dispatch<React.SetStateAction<SelectionRange | null>>;
  setCursor: (cursor: { line: number; char: number }) => void;
  setIsSearchOpen: (open: boolean) => void;
  scrollToCursor: (pos?: { line: number; char: number }) => void;
  /** 一页对应的行数（PageUp/PageDown 用） */
  pageLines: number;
  /** 额外光标数量（多光标批量编辑开关） */
  extraCursorCount: number;
  /** Ctrl+D：选词或添加下一匹配 */
  handleCtrlD: () => void;
  clearExtraCursors: () => void;
  handleMultiCursorBackspace: () => void;
  handleMultiCursorDelete: () => void;
  handleMultiCursorEnter: () => void;
}

export function useEditorKeybindings({
  language,
  documentLines,
  cursor,
  selection,
  isComposing,
  completions,
  completionIndex,
  replaceDocumentLines,
  insertTextAtCursor,
  executeSelectionDelete,
  moveCursor,
  handleUndo,
  handleRedo,
  triggerAutocomplete,
  handleAutocompleteSelect,
  setCompletions,
  setCompletionIndex,
  setSelection,
  setCursor,
  setIsSearchOpen,
  scrollToCursor,
  pageLines,
  extraCursorCount,
  handleCtrlD,
  clearExtraCursors,
  handleMultiCursorBackspace,
  handleMultiCursorDelete,
  handleMultiCursorEnter,
}: UseEditorKeybindingsProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 1. 输入法合成中直接放行（补全面板拦截必须在合成判断之后，否则会劫持 IME 候选窗按键）
      if (isComposing) return;

      // 2. 自动补全菜单拦截
      if (completions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCompletionIndex((prev) => (prev + 1) % completions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setCompletionIndex((prev) => (prev - 1 + completions.length) % completions.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          handleAutocompleteSelect(completionIndex);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setCompletions([]);
          return;
        }
      }

      const lines = [...documentLines];
      const { line, char } = cursor;
      const lineText = lines[line] || "";

      // 手动触发补全 Ctrl+Space
      if (e.key === " " && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        triggerAutocomplete(lines, line, char, true);
        return;
      }

      // 撤销 / 重做 (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (e.key === "y" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // 全选 Ctrl+A
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelection({
          start: { line: 0, char: 0 },
          end: { line: lines.length - 1, char: lines[lines.length - 1].length },
        });
        setCursor({ line: lines.length - 1, char: lines[lines.length - 1].length });
        return;
      }

      // 搜索 Ctrl+F
      if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      // 多光标：Ctrl+D 选词/添加下一匹配；Esc 清除额外光标
      if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleCtrlD();
        return;
      }
      if (e.key === "Escape" && extraCursorCount > 0) {
        e.preventDefault();
        clearExtraCursors();
        return;
      }

      // 行注释切换 Ctrl+/（多光标下降级为主光标，避免行操作后 extra 光标位置失真）
      if (e.code === "Slash" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (extraCursorCount > 0) {
          clearExtraCursors();
          showToast(LocaleService.translate("editor.multiCursorLineOpsDegrade"));
        }
        const marker = ["python", "shellscript", "yaml", "toml", "powershell"].includes(language)
          ? "#"
          : ["html", "css", "scss", "markdown", "plaintext"].includes(language)
            ? null
            : "//";
        if (marker) {
          const range = affectedLineRange(line, selection);
          const result = toggleLineComment(lines, range, marker);
          const delta = marker.length + 1;
          const adjust = (position: { line: number; char: number }) => ({
            line: position.line,
            char:
              position.line >= range.startLine && position.line <= range.endLine
                ? Math.max(0, position.char + (result.uncommented ? -delta : delta))
                : position.char,
          });
          const nextSelection = selection
            ? { start: adjust(selection.start), end: adjust(selection.end) }
            : null;
          replaceDocumentLines(result.lines, adjust(cursor), nextSelection);
        }
        return;
      }

      // 复制行 Alt+Shift+Down（多光标下降级为主光标）
      if (e.altKey && e.shiftKey && e.key === "ArrowDown") {
        e.preventDefault();
        if (extraCursorCount > 0) {
          clearExtraCursors();
          showToast(LocaleService.translate("editor.multiCursorLineOpsDegrade"));
        }
        const range = affectedLineRange(line, selection);
        const result = duplicateLineRange(lines, range);
        const lineDelta = result.range.startLine - range.startLine;
        const nextSelection = selection
          ? {
              start: { ...selection.start, line: selection.start.line + lineDelta },
              end: { ...selection.end, line: selection.end.line + lineDelta },
            }
          : null;
        replaceDocumentLines(
          result.lines,
          { ...cursor, line: cursor.line + lineDelta },
          nextSelection,
        );
        return;
      }

      // 移动行 Alt+Up / Alt+Down（多光标下降级为主光标）
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (extraCursorCount > 0) {
          clearExtraCursors();
          showToast(LocaleService.translate("editor.multiCursorLineOpsDegrade"));
        }
        const range = affectedLineRange(line, selection);
        const direction = e.key === "ArrowUp" ? -1 : 1;
        const result = moveLineRange(lines, range, direction);
        const lineDelta = result.range.startLine - range.startLine;
        if (lineDelta !== 0) {
          const nextSelection = selection
            ? {
                start: { ...selection.start, line: selection.start.line + lineDelta },
                end: { ...selection.end, line: selection.end.line + lineDelta },
              }
            : null;
          replaceDocumentLines(
            result.lines,
            { ...cursor, line: cursor.line + lineDelta },
            nextSelection,
          );
        }
        return;
      }

      // 括号/引号自动闭合与包裹：无选区补对、有选区包裹、重复输入跳过
      if (!e.ctrlKey && !e.metaKey && !e.altKey && AUTO_PAIRS[e.key] && lines.length > 0) {
        const closer = AUTO_PAIRS[e.key];
        const nextChar = lineText[char];
        // 光标后恰为相同字符（闭合符或引号）：over-type 跳过，避免成对堆积
        if (nextChar === e.key && CLOSERS.has(e.key) && !selection) {
          e.preventDefault();
          moveCursor(line, char + 1, false);
          return;
        }
        e.preventDefault();
        // 无选区输入引号且前一字符是单词字符：不自动补对（避免 markdown/所有格误补）
        if (!selection && (e.key === '"' || e.key === "'" || e.key === "`")) {
          const prevChar = char > 0 ? lineText[char - 1] : "";
          if (prevChar && WORD_CHAR.test(prevChar)) {
            insertTextAtCursor(e.key);
            return;
          }
        }
        if (selection) {
          const { start, end } = sortSelection(selection);
          const nextLines = [...lines];
          let nextSelection: SelectionRange;
          if (start.line === end.line) {
            const text = lines[start.line] || "";
            nextLines[start.line] =
              text.slice(0, start.char) +
              e.key +
              text.slice(start.char, end.char) +
              closer +
              text.slice(end.char);
            nextSelection = {
              start: { line: start.line, char: start.char },
              end: { line: start.line, char: end.char + e.key.length + closer.length - 1 },
            };
          } else {
            // 跨行包裹：起始行首插入 opener，结束行尾插入 closer
            nextLines[start.line] = e.key + (lines[start.line] || "");
            nextLines[end.line] = (lines[end.line] || "") + closer;
            nextSelection = {
              start: { line: start.line, char: 0 },
              end: { line: end.line, char: (lines[end.line] || "").length + 1 },
            };
          }
          const anchor = sortSelection(nextSelection).start;
          replaceDocumentLines(nextLines, { line: anchor.line, char: anchor.char }, nextSelection);
          return;
        }
        // 无选区：插入配对，光标居中
        const nextLines = [...lines];
        nextLines[line] = lineText.slice(0, char) + e.key + closer + lineText.slice(char);
        replaceDocumentLines(nextLines, { line, char: char + e.key.length });
        return;
      }

      // 缩进 / 反缩进 Tab / Shift+Tab
      if (e.key === "Tab") {
        e.preventDefault();
        if (selection && selection.start.line !== selection.end.line) {
          const range = affectedLineRange(line, selection);
          if (e.shiftKey) {
            const result = outdentLineRange(lines, range, 2);
            replaceDocumentLines(result.lines, cursor, selection);
          } else {
            const nextLines = indentLineRange(lines, range, "  ");
            replaceDocumentLines(nextLines, cursor, selection);
          }
        } else {
          if (e.shiftKey) {
            const range = affectedLineRange(line, selection);
            const result = outdentLineRange(lines, range, 2);
            replaceDocumentLines(result.lines, { ...cursor, char: Math.max(0, char - 2) }, null);
          } else {
            insertTextAtCursor("  ");
          }
        }
        return;
      }

      // 退格键 Backspace
      if (e.key === "Backspace") {
        e.preventDefault();
        if (extraCursorCount > 0) {
          handleMultiCursorBackspace();
          return;
        }
        if (selection) {
          executeSelectionDelete();
          return;
        }
        // Ctrl+Backspace：向前删除一个词（复用词边界逻辑），行首则并入上一行
        if (e.ctrlKey || e.metaKey) {
          const wordStart = findWordJump(lineText, char, false);
          if (wordStart !== null) {
            lines[line] = lineText.slice(0, wordStart) + lineText.slice(char);
            replaceDocumentLines(lines, { line, char: wordStart });
          } else if (line > 0) {
            const prevLineText = lines[line - 1];
            const nextLines = [...lines];
            nextLines[line - 1] = prevLineText + lineText;
            nextLines.splice(line, 1);
            replaceDocumentLines(nextLines, { line: line - 1, char: prevLineText.length });
          }
          return;
        }
        if (char > 0) {
          const prevChar = lineText[char - 1];
          const nextChar = lineText[char];
          const isPair =
            (prevChar === "(" && nextChar === ")") ||
            (prevChar === "[" && nextChar === "]") ||
            (prevChar === "{" && nextChar === "}") ||
            (prevChar === '"' && nextChar === '"') ||
            (prevChar === "'" && nextChar === "'") ||
            (prevChar === "`" && nextChar === "`");

          const deleteCount = isPair ? 2 : 1;
          const nextLine =
            lineText.substring(0, char - 1) + lineText.substring(char + (deleteCount - 1));
          lines[line] = nextLine;
          replaceDocumentLines(lines, { line, char: char - 1 });
        } else if (line > 0) {
          const prevLineText = lines[line - 1];
          const nextLines = [...lines];
          nextLines[line - 1] = prevLineText + lineText;
          nextLines.splice(line, 1);
          replaceDocumentLines(nextLines, { line: line - 1, char: prevLineText.length });
        }
        return;
      }

      // Delete 键
      if (e.key === "Delete") {
        e.preventDefault();
        if (extraCursorCount > 0) {
          handleMultiCursorDelete();
          return;
        }
        if (selection) {
          executeSelectionDelete();
          return;
        }
        // Ctrl+Delete：向后删除一个词（复用词边界逻辑），行尾则并入下一行
        if (e.ctrlKey || e.metaKey) {
          const wordEnd = findWordJump(lineText, char, true);
          if (wordEnd !== null) {
            lines[line] = lineText.slice(0, char) + lineText.slice(wordEnd);
            replaceDocumentLines(lines, { line, char });
          } else if (line < lines.length - 1) {
            const nextLineText = lines[line + 1];
            const nextLines = [...lines];
            nextLines[line] = lineText + nextLineText;
            nextLines.splice(line + 1, 1);
            replaceDocumentLines(nextLines, { line, char });
          }
          return;
        }
        if (char < lineText.length) {
          const nextLine = lineText.substring(0, char) + lineText.substring(char + 1);
          lines[line] = nextLine;
          replaceDocumentLines(lines, { line, char });
        } else if (line < lines.length - 1) {
          const nextLineText = lines[line + 1];
          const nextLines = [...lines];
          nextLines[line] = lineText + nextLineText;
          nextLines.splice(line + 1, 1);
          replaceDocumentLines(nextLines, { line, char });
        }
        return;
      }

      // 回车键 Enter（智能缩进与括号闭合）
      if (e.key === "Enter") {
        e.preventDefault();
        if (extraCursorCount > 0) {
          handleMultiCursorEnter();
          return;
        }
        // 有选区时先在内存中删除选区（executeSelectionDelete 的异步 setState 会被后续计算覆盖）
        let effectiveLines = lines;
        let effectiveCursor = cursor;
        if (selection) {
          const deletion = getLinesAfterDeletion(lines, selection);
          effectiveLines = deletion.lines;
          effectiveCursor = deletion.cursor;
        }

        const { line: effLine, char: effChar } = effectiveCursor;
        const currentLineText = effectiveLines[effLine] || "";
        const indentMatch = currentLineText.match(/^(\s*)/);
        let indent = indentMatch ? indentMatch[1] : "";

        const beforeCursor = currentLineText.substring(0, effChar);
        const afterCursor = currentLineText.substring(effChar);

        const isBetweenBrackets =
          (beforeCursor.endsWith("{") && afterCursor.startsWith("}")) ||
          (beforeCursor.endsWith("(") && afterCursor.startsWith(")")) ||
          (beforeCursor.endsWith("[") && afterCursor.startsWith("]"));

        if (isBetweenBrackets) {
          const extraIndent = "  ";
          const nextLines = [...effectiveLines];
          nextLines[effLine] = beforeCursor;
          nextLines.splice(effLine + 1, 0, `${indent}${extraIndent}`, `${indent}${afterCursor}`);
          replaceDocumentLines(nextLines, {
            line: effLine + 1,
            char: indent.length + extraIndent.length,
          });
          return;
        }

        if (beforeCursor.trimEnd().endsWith("{") || beforeCursor.trimEnd().endsWith(":")) {
          indent += "  ";
        }

        const nextLines = [...effectiveLines];
        nextLines[effLine] = beforeCursor;
        nextLines.splice(effLine + 1, 0, `${indent}${afterCursor}`);
        replaceDocumentLines(nextLines, { line: effLine + 1, char: indent.length });
        return;
      }

      // 方向键移动
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (char > 0) {
          moveCursor(line, char - 1, e.shiftKey);
        } else if (line > 0) {
          moveCursor(line - 1, lines[line - 1].length, e.shiftKey);
        }
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (char < lineText.length) {
          moveCursor(line, char + 1, e.shiftKey);
        } else if (line < lines.length - 1) {
          moveCursor(line + 1, 0, e.shiftKey);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (line > 0) {
          const targetChar = Math.min(char, lines[line - 1].length);
          moveCursor(line - 1, targetChar, e.shiftKey);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (line < lines.length - 1) {
          const targetChar = Math.min(char, lines[line + 1].length);
          moveCursor(line + 1, targetChar, e.shiftKey);
        }
        return;
      }

      // Ctrl+←/→ 词级跳转（跨行，含 Shift 扩选）
      if ((e.ctrlKey || e.metaKey) && e.key === "ArrowRight") {
        e.preventDefault();
        let target: { line: number; char: number } = {
          line: lines.length - 1,
          char: (lines[lines.length - 1] || "").length,
        };
        for (let l = line; l < lines.length; l++) {
          const text = lines[l] || "";
          const jump = findWordJump(text, l === line ? char : 0, true);
          if (jump !== null && !(l === line && jump === char)) {
            target = { line: l, char: jump };
            break;
          }
        }
        moveCursor(target.line, target.char, e.shiftKey);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft") {
        e.preventDefault();
        let target: { line: number; char: number } = { line: 0, char: 0 };
        for (let l = line; l >= 0; l--) {
          const text = lines[l] || "";
          if (l !== line && text.length === 0) continue;
          const jump = findWordJump(text, l === line ? char : text.length, false);
          if (jump !== null && !(l === line && jump === char)) {
            target = { line: l, char: jump };
            break;
          }
        }
        moveCursor(target.line, target.char, e.shiftKey);
        return;
      }

      // PageUp / PageDown 按视口行数翻页（含 Shift 扩选）
      if (e.key === "PageDown") {
        e.preventDefault();
        const targetLine = Math.min(lines.length - 1, line + Math.max(1, pageLines));
        moveCursor(targetLine, Math.min(char, (lines[targetLine] || "").length), e.shiftKey);
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        const targetLine = Math.max(0, line - Math.max(1, pageLines));
        moveCursor(targetLine, Math.min(char, (lines[targetLine] || "").length), e.shiftKey);
        return;
      }

      // Ctrl+Home / Ctrl+End 跳到文首 / 文尾（含 Shift 扩选）
      if (e.key === "Home" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        moveCursor(0, 0, e.shiftKey);
        return;
      }
      if (e.key === "End" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const last = lines.length - 1;
        moveCursor(last, (lines[last] || "").length, e.shiftKey);
        return;
      }

      // Home / End
      if (e.key === "Home") {
        e.preventDefault();
        const firstNonSpace = lineText.search(/\S/);
        const target = char === firstNonSpace || firstNonSpace === -1 ? 0 : firstNonSpace;
        moveCursor(line, target, e.shiftKey);
        scrollToCursor({ line, char: target });
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        moveCursor(line, lineText.length, e.shiftKey);
        scrollToCursor({ line, char: lineText.length });
        return;
      }
    },
    [
      completions.length,
      isComposing,
      documentLines,
      cursor,
      selection,
      language,
      setCompletionIndex,
      handleAutocompleteSelect,
      completionIndex,
      setCompletions,
      triggerAutocomplete,
      handleRedo,
      handleUndo,
      setSelection,
      setCursor,
      setIsSearchOpen,
      replaceDocumentLines,
      insertTextAtCursor,
      executeSelectionDelete,
      moveCursor,
      scrollToCursor,
      pageLines,
      extraCursorCount,
      handleCtrlD,
      clearExtraCursors,
      handleMultiCursorBackspace,
      handleMultiCursorDelete,
      handleMultiCursorEnter,
    ],
  );

  return { handleKeyDown };
}
