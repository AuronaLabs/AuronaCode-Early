import { useCallback, useRef, useState } from "react";
import { DocumentService } from "../../../Core/DocumentService";
import { LspClient } from "../../../Core/Language/LspClient";
import { applyLspTextEdits } from "../../../Core/Language/TextEdits";
import type { LanguageFeaturePreferences } from "../../../Foundation/Types/Config";
import type { CompletionItem } from "../../../Foundation/Types/Lsp";
import type { EditorHoverState } from "../components/HoverCard";
import { rankCompletionItems } from "../Utils/EditorCompletion";
import type { EditorLayoutMetrics } from "../Utils/EditorLayoutMetrics";
import { editorPointToViewport } from "../Utils/EditorOverlay";

export interface UseEditorAutocompleteProps {
  path?: string;
  language: string;
  layout: EditorLayoutMetrics;
  languagePreferences: Required<LanguageFeaturePreferences>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  caretPos: { x: number; y: number };
  scrollTop: number;
  documentLines: string[];
  cursor: { line: number; char: number };
  replaceDocumentLines: (
    nextLines: string[],
    nextCursor: { line: number; char: number },
    nextSelection?: {
      start: { line: number; char: number };
      end: { line: number; char: number };
    } | null,
  ) => void;
  setVisibleHover: (hover: EditorHoverState | null) => void;
}

export function useEditorAutocomplete({
  path,
  language,
  layout,
  languagePreferences,
  containerRef,
  caretPos,
  scrollTop,
  documentLines,
  cursor,
  replaceDocumentLines,
  setVisibleHover,
}: UseEditorAutocompleteProps) {
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionPos, setCompletionPos] = useState({ x: 0, y: 0 });

  const completionRequestRef = useRef<number | null>(null);
  const completionSequenceRef = useRef(0);
  const completionTimerRef = useRef<number | null>(null);

  const closeAutocomplete = useCallback(() => {
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    setCompletions([]);
  }, []);

  const triggerAutocomplete = useCallback(
    (lines: string[], lineIndex: number, charIndex: number, manual = false) => {
      if (!path) return;
      if (!manual && !languagePreferences.automaticCompletion) {
        closeAutocomplete();
        return;
      }
      const lineText = lines[lineIndex] || "";
      const prefix = lineText.substring(0, charIndex).match(/[a-zA-Z0-9_]*$/)?.[0] ?? "";
      if (!manual && prefix.length < 1) {
        closeAutocomplete();
        return;
      }

      const expectedContent = lines.join("\n");
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
      if (completionRequestRef.current !== null) {
        void LspClient.getInstance().cancelRequest(language, completionRequestRef.current);
      }
      completionTimerRef.current = window.setTimeout(
        () => {
          completionTimerRef.current = null;
          const requestId = completionSequenceRef.current++;
          completionRequestRef.current = requestId;
          void DocumentService.flush(path)
            .then(() =>
              LspClient.getInstance().getCompletions(
                language,
                path,
                lineIndex,
                charIndex,
                requestId,
              ),
            )
            .then((response) => {
              if (
                completionRequestRef.current !== requestId ||
                DocumentService.get(path)?.content !== expectedContent
              ) {
                return;
              }
              const rawItems = Array.isArray(response) ? response : (response?.items ?? []);
              const items = rankCompletionItems(rawItems, prefix);
              if (!items.length) {
                setCompletions([]);
                return;
              }
              const container = containerRef.current;
              if (!container) return;
              const bounds = container.getBoundingClientRect();
              const viewportPoint = editorPointToViewport(
                bounds,
                {
                  x: caretPos.x,
                  y: layout.contentInsetTop + (lineIndex + 1) * layout.lineHeight + 6,
                },
                { left: container.scrollLeft, top: container.scrollTop },
              );
              setCompletionPos(viewportPoint);
              setCompletions(items);
              setCompletionIndex(0);
            })
            .catch((error) => {
              if (completionRequestRef.current === requestId) setCompletions([]);
              if (manual) {
                const bounds = containerRef.current?.getBoundingClientRect();
                const left = (bounds?.left ?? 0) + caretPos.x;
                const top =
                  (bounds?.top ?? 0) +
                  layout.contentInsetTop +
                  lineIndex * layout.lineHeight -
                  scrollTop;
                setVisibleHover({
                  anchor: {
                    left,
                    right: left,
                    top,
                    bottom: top + layout.lineHeight,
                  },
                  title: "无法获取补全",
                  text: error instanceof Error ? error.message : String(error),
                  tone: "warning",
                });
              }
            })
            .finally(() => {
              if (completionRequestRef.current === requestId) {
                completionRequestRef.current = null;
              }
            });
        },
        manual ? 0 : 120,
      );
    },
    [
      caretPos.x,
      closeAutocomplete,
      containerRef,
      language,
      languagePreferences.automaticCompletion,
      layout,
      path,
      scrollTop,
      setVisibleHover,
    ],
  );

  const handleAutocompleteSelect = useCallback(
    (index: number) => {
      const item = completions[index];
      if (!item || !path) return;
      const content = documentLines.join("\n");
      const { line, char } = cursor;
      const lineText = documentLines[line] ?? "";
      const prefix = lineText.substring(0, char).match(/[a-zA-Z0-9_]*$/)?.[0] ?? "";
      const rawText = item.textEdit?.newText ?? item.insertText ?? item.label;
      const newText = rawText.replace(/\$\{\d+:[^}]*\}|\$\d+/g, "");

      if (item.textEdit) {
        const edits = [item.textEdit];
        if (item.additionalTextEdits) edits.push(...item.additionalTextEdits);
        const result = applyLspTextEdits(content, edits);
        const nextLines = result.content.split("\n");
        const nextCursor = {
          line: Math.min(nextLines.length - 1, line),
          char: Math.max(0, char - prefix.length + newText.length),
        };
        replaceDocumentLines(nextLines, nextCursor);
      } else {
        const replaceStart = Math.max(0, char - prefix.length);
        const nextLine = lineText.substring(0, replaceStart) + newText + lineText.substring(char);
        const nextLines = [...documentLines];
        nextLines[line] = nextLine;
        const nextCursor = { line, char: replaceStart + newText.length };
        replaceDocumentLines(nextLines, nextCursor);
      }
      closeAutocomplete();
    },
    [closeAutocomplete, completions, cursor, documentLines, path, replaceDocumentLines],
  );

  return {
    completions,
    completionIndex,
    completionPos,
    setCompletionIndex,
    setCompletions,
    closeAutocomplete,
    triggerAutocomplete,
    handleAutocompleteSelect,
  };
}
