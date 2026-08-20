import type React from "react";
import { useCallback } from "react";
import type { LanguageFeaturePreferences } from "../../../Foundation/Types/Config";
import type { CompletionItem } from "../../../Foundation/Types/Lsp";
import {
  affectedLineRange,
  duplicateLineRange,
  indentLineRange,
  moveLineRange,
  outdentLineRange,
  toggleLineComment,
} from "../Utils/EditorLineOperations";
import type { SelectionRange } from "./useEditorSelectionOps";

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
}: UseEditorKeybindingsProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 1. 自动补全菜单拦截
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

      // 2. 输入法合成中直接放行
      if (isComposing) return;

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

      // 行注释切换 Ctrl+/
      if (e.code === "Slash" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
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

      // 复制行 Alt+Shift+Down
      if (e.altKey && e.shiftKey && e.key === "ArrowDown") {
        e.preventDefault();
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

      // 移动行 Alt+Up / Alt+Down
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
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
        if (selection) {
          executeSelectionDelete();
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
        if (selection) {
          executeSelectionDelete();
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
        if (selection) executeSelectionDelete();

        const currentLineText = lines[line] || "";
        const indentMatch = currentLineText.match(/^(\s*)/);
        let indent = indentMatch ? indentMatch[1] : "";

        const beforeCursor = currentLineText.substring(0, char);
        const afterCursor = currentLineText.substring(char);

        const isBetweenBrackets =
          (beforeCursor.endsWith("{") && afterCursor.startsWith("}")) ||
          (beforeCursor.endsWith("(") && afterCursor.startsWith(")")) ||
          (beforeCursor.endsWith("[") && afterCursor.startsWith("]"));

        if (isBetweenBrackets) {
          const extraIndent = "  ";
          const nextLines = [...lines];
          nextLines[line] = beforeCursor;
          nextLines.splice(line + 1, 0, `${indent}${extraIndent}`, `${indent}${afterCursor}`);
          replaceDocumentLines(nextLines, {
            line: line + 1,
            char: indent.length + extraIndent.length,
          });
          return;
        }

        if (beforeCursor.trimEnd().endsWith("{") || beforeCursor.trimEnd().endsWith(":")) {
          indent += "  ";
        }

        const nextLines = [...lines];
        nextLines[line] = beforeCursor;
        nextLines.splice(line + 1, 0, `${indent}${afterCursor}`);
        replaceDocumentLines(nextLines, { line: line + 1, char: indent.length });
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
    ],
  );

  return { handleKeyDown };
}
