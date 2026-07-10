import hljs from "highlight.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { EventBus } from "../../Foundation/EventBus";
import type {
  EditorStatus,
  EditorStatusListener,
  IEditorEngine,
} from "../../Foundation/Types/Editor";
import { AutocompleteMenu, type CompletionItem } from "./components/AutocompleteMenu";
import { SearchWidget } from "./components/SearchWidget";
import { EditorAdapter } from "./EditorAdapter";
import { LspClient } from "./LspClient";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuDivider,
} from "../../UI/Components/ContextMenu";
import { useEditorHistory } from "./Hooks/useEditorHistory";
import { useEditorSelection } from "./Hooks/useEditorSelection";

export type AuronaEngineProps = {
  value: string;
  language: string;
  isActive?: boolean;
  onChange?: (value: string) => void;
  path?: string;
};

export const AuronaEngine = React.memo(function AuronaEngine({
  value,
  language,
  isActive = true,
  onChange,
  path,
}: AuronaEngineProps) {
  const [content, setContent] = useState(value);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );

  
  const { pushHistory, undo, redo, historyTimerRef, syncExternalValue } = useEditorHistory(value);
  const { currentLine, statusListenersRef, statusRef, emitStatus, updateStatus, getLineAndChar, lineStarts } = useEditorSelection(content, path, language);

  
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Autocomplete
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionPos, setCompletionPos] = useState({
    x: 0,
    y: 0,
    line: 0,
    character: 0,
    prefix: "",
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const charWidthRef = useRef<number>(8.4);
  const lineHeightRef = useRef<number>(21);
  const contentRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const completionTimerRef = useRef<number | null>(null);
  const didChangeTimerRef = useRef<number | null>(null);
  const pendingLspReqIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
      if (didChangeTimerRef.current) window.clearTimeout(didChangeTimerRef.current);
      if (pendingLspReqIdRef.current && language) {
        LspClient.getInstance().cancelRequest(language, pendingLspReqIdRef.current);
      }
    };
  }, [language]);

  useEffect(() => {
    const span = document.createElement("span");
    span.style.fontFamily = "var(--EditorFontFamily)";
    span.style.fontSize = "var(--EditorFontSize)";
    span.style.lineHeight = "var(--EditorLineHeight)";
    span.style.visibility = "hidden";
    span.style.position = "absolute";
    span.textContent = "a";
    document.body.appendChild(span);
    const rect = span.getBoundingClientRect();
    charWidthRef.current = rect.width;
    lineHeightRef.current = rect.height || 21;
    document.body.removeChild(span);
  }, []);

  useEffect(() => {
    setDiagnostics([]);
    const unsub = EventBus.on("lsp:diagnostics", (payload: any) => {
      if (!path) return;
      const formattedPath = `file:///${path.replace(/\\/g, "/")}`;
      if (payload.uri === formattedPath) {
        setDiagnostics(payload.diagnostics || []);
      }
    });
    return () => unsub();
  }, [path]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (value !== contentRef.current) {
      setContent(value);
      syncExternalValue(value);
    }
  }, [value, syncExternalValue]);

  useEffect(() => {
    if (!isActive) return;
    const unsub = EventBus.on("editor:action", (action: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      
      switch (action) {
        case "undo":
          document.execCommand("undo");
          break;
        case "redo":
          document.execCommand("redo");
          break;
        case "cut":
          document.execCommand("cut");
          break;
        case "copy":
          document.execCommand("copy");
          break;
        case "paste":
          document.execCommand("paste");
          break;
        case "selectAll":
          textarea.select();
          break;
      }
    });
    return () => unsub();
  }, [isActive]);

  const engineImplRef = useRef<IEditorEngine | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    const selectionStart = e.target.selectionStart;
    setContent(newContent);
    onChange?.(newContent);

    
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = window.setTimeout(() => {
      pushHistory(newContent, selectionStart);
    }, 800);

    updateStatus(selectionStart, e.target.selectionEnd);

    if (path && language) {
      if (didChangeTimerRef.current) window.clearTimeout(didChangeTimerRef.current);
      didChangeTimerRef.current = window.setTimeout(() => {
        LspClient.getInstance().didChange(language, path, newContent);
      }, 300);

      const { line, char: character } = getLineAndChar(selectionStart);

      const textBeforeCursor = newContent.substring(0, selectionStart);
      const lastLineMatch = textBeforeCursor.match(/[^\n]*$/);
      const lastLine = lastLineMatch ? lastLineMatch[0] : "";

      const match = lastLine.match(/[a-zA-Z0-9_]*$/);
      const prefix = match ? match[0] : "";

      const lastChar = textBeforeCursor.slice(-1);
      const isTriggerChar = lastChar === "." || lastChar === ":" || lastChar === ">";

      if (character > 0 && (prefix.length > 0 || isTriggerChar)) {
        if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
        if (pendingLspReqIdRef.current) {
          LspClient.getInstance().cancelRequest(language, pendingLspReqIdRef.current);
          pendingLspReqIdRef.current = null;
        }

        const reqId = Date.now();
        completionTimerRef.current = window.setTimeout(() => {
          pendingLspReqIdRef.current = reqId;
          LspClient.getInstance()
            .getCompletions(language, path, line, character, reqId)
            .then((res: any) => {
              if (pendingLspReqIdRef.current !== reqId) return; // Ignore if a new request was made
              pendingLspReqIdRef.current = null;

              let items: CompletionItem[] = [];
              if (Array.isArray(res)) items = res;
              else if (res && res.items) items = res.items;

              if (items.length > 0) {
                const rect = textareaRef.current?.getBoundingClientRect();
                if (rect && textareaRef.current) {
                  const x =
                    rect.left +
                    character * charWidthRef.current -
                    textareaRef.current.scrollLeft +
                    16;
                  const y =
                    rect.top +
                    (line + 1) * lineHeightRef.current -
                    textareaRef.current.scrollTop +
                    16;
                  setCompletionPos({ x, y, line, character, prefix });
                  setCompletions(items.slice(0, 50));
                  setCompletionIndex(0);
                }
              } else {
                setCompletions([]);
              }
            });
        }, 150);
      } else {
        if (pendingLspReqIdRef.current) {
          LspClient.getInstance().cancelRequest(language, pendingLspReqIdRef.current);
          pendingLspReqIdRef.current = null;
        }
        setCompletions([]);
      }
    }
  };

  const handleAutocompleteSelect = (index: number) => {
    const item = completions[index];
    if (!item) return;
    const el = textareaRef.current;
    if (!el) return;

    const insertText = item.insertText || item.label;
    const textBeforeCursor = content.substring(0, el.selectionStart - completionPos.prefix.length);
    const textAfterCursor = content.substring(el.selectionStart);
    const newContent = textBeforeCursor + insertText + textAfterCursor;

    setContent(newContent);
    onChange?.(newContent);
    setCompletions([]);

    const newCursor = textBeforeCursor.length + insertText.length;
    pushHistory(newContent, newCursor);

    setTimeout(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = newCursor;
      updateStatus(newCursor, newCursor);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = textareaRef.current;
    if (!el) return;

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

    
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
    if (pairs[e.key]) {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const closing = pairs[e.key];
      const newContent = content.substring(0, start) + e.key + closing + content.substring(end);
      setContent(newContent);
      onChange?.(newContent);
      pushHistory(newContent, start + 1);
      setTimeout(() => {
        el.selectionStart = el.selectionEnd = start + 1;
        updateStatus(start + 1, start + 1);
      }, 0);
      return;
    }

    
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const start = el.selectionStart;
      const textBefore = content.substring(0, start);
      const lastLineMatch = textBefore.match(/[^\n]*$/);
      const lastLine = lastLineMatch ? lastLineMatch[0] : "";

      const indentMatch = lastLine.match(/^\s*/);
      let indent = indentMatch ? indentMatch[0] : "";

      if (lastLine.trim().endsWith("{") || lastLine.trim().endsWith("[")) {
        indent += "  ";
      }

      const newContent =
        content.substring(0, start) + "\n" + indent + content.substring(el.selectionEnd);
      setContent(newContent);
      onChange?.(newContent);
      pushHistory(newContent, start + 1 + indent.length);
      setTimeout(() => {
        el.selectionStart = el.selectionEnd = start + 1 + indent.length;
        updateStatus(start + 1 + indent.length, start + 1 + indent.length);
      }, 0);
      return;
    }

    if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setIsSearchOpen(true);
      return;
    }

    if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const prevState = undo();
      if (prevState) {
        setContent(prevState.content);
        onChange?.(prevState.content);
        setTimeout(() => {
          el.selectionStart = el.selectionEnd = prevState.selectionStart;
          updateStatus(prevState.selectionStart, prevState.selectionStart);
        }, 0);
      }
      return;
    }

    if (e.key === "y" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const nextState = redo();
      if (nextState) {
        setContent(nextState.content);
        onChange?.(nextState.content);
        setTimeout(() => {
          el.selectionStart = el.selectionEnd = nextState.selectionStart;
          updateStatus(nextState.selectionStart, nextState.selectionStart);
        }, 0);
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newContent = content.substring(0, start) + "  " + content.substring(end);
      setContent(newContent);
      onChange?.(newContent);
      pushHistory(newContent, start + 2);
      setTimeout(() => {
        el.selectionStart = el.selectionEnd = start + 2;
        updateStatus(start + 2, start + 2);
      }, 0);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (diagnostics.length === 0) {
      if (hoverTooltip) setHoverTooltip(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    const y = e.clientY - rect.top + e.currentTarget.scrollTop;

    const line = Math.floor((y - 16) / lineHeightRef.current);
    const character = Math.floor((x - 16) / charWidthRef.current);

    if (line >= 0 && character >= 0) {
      const diag = diagnostics.find(
        (d) =>
          line >= d.range.start.line &&
          line <= d.range.end.line &&
          character >= d.range.start.character &&
          character <= d.range.end.character,
      );

      if (diag) {
        setHoverTooltip({ x: e.clientX, y: e.clientY + 20, text: diag.message });
      } else if (hoverTooltip) {
        setHoverTooltip(null);
      }
    } else if (hoverTooltip) {
      setHoverTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    if (hoverTooltip) setHoverTooltip(null);
  };

  useEffect(() => {
    if (!searchQuery) {
      setSearchMatches([]);
      return;
    }
    const matches: number[] = [];
    let idx = content.toLowerCase().indexOf(searchQuery.toLowerCase());
    while (idx !== -1) {
      matches.push(idx);
      idx = content.toLowerCase().indexOf(searchQuery.toLowerCase(), idx + searchQuery.length);
    }
    setSearchMatches(matches);
    setCurrentMatchIndex(0);
  }, [searchQuery, content]);

  const handleSearchNext = () => {
    if (searchMatches.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIdx);
    scrollToMatch(searchMatches[nextIdx]);
  };

  const handleSearchPrev = () => {
    if (searchMatches.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIdx);
    scrollToMatch(searchMatches[prevIdx]);
  };

  const scrollToMatch = (index: number) => {
    if (!textareaRef.current) return;
    const { line } = getLineAndChar(index);
    const top = line * lineHeightRef.current;

    
    textareaRef.current.parentElement?.parentElement?.scrollTo({
      top: top - 100,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    const engineImpl: IEditorEngine = {
      getText: () => textareaRef.current?.value || "",
      getSelectionText: () => {
        const el = textareaRef.current;
        if (!el) return "";
        return el.value.substring(el.selectionStart, el.selectionEnd);
      },
      insertCode: (text: string, atCursor: boolean = true) => {
        const el = textareaRef.current;
        if (!el) return;
        const curContent = contentRef.current;
        if (atCursor) {
          const start = el.selectionStart;
          const end = el.selectionEnd;
          const newText = curContent.substring(0, start) + text + curContent.substring(end);
          setContent(newText);
          onChangeRef.current?.(newText);
          pushHistory(newText, start + text.length);
          setTimeout(() => {
            el.selectionStart = el.selectionEnd = start + text.length;
            updateStatus(start + text.length, start + text.length);
          }, 0);
        } else {
          const newText = curContent + text;
          setContent(newText);
          onChangeRef.current?.(newText);
          pushHistory(newText, newText.length);
          const el = textareaRef.current;
          if (el) updateStatus(el.selectionStart, el.selectionEnd);
        }
      },
      replaceRange: (startLine: number, endLine: number, newText: string) => {
        const el = textareaRef.current;
        if (!el) return;
        const lines = contentRef.current.split("\n");
        const newLines = [...lines.slice(0, startLine - 1), newText, ...lines.slice(endLine)];
        const resText = newLines.join("\n");
        setContent(resText);
        onChangeRef.current?.(resText);
        pushHistory(resText, el.selectionStart);
        if (el) updateStatus(el.selectionStart, el.selectionEnd);
      },
      getStatus: () => statusRef.current,
      onStatusChange: (listener: EditorStatusListener) => {
        statusListenersRef.current.add(listener);
        listener(statusRef.current);
        return () => statusListenersRef.current.delete(listener);
      },
    };
    engineImplRef.current = engineImpl;
    if (isActive) {
      EditorAdapter.bindEngine(engineImpl);
    }
    return () => {
      EditorAdapter.unbindEngine(engineImpl);
    };
  }, [isActive, updateStatus, pushHistory]);

  useEffect(() => {
    const el = textareaRef.current;
    if (isActive && el) updateStatus(el.selectionStart, el.selectionEnd);
  }, [isActive, updateStatus]);

  useEffect(() => {
    if (!path || !language) return;
    const lsp = LspClient.getInstance();
    const initLsp = async () => {
      await lsp.startServer(language);
      await lsp.didOpen(language, path, content);
    };
    initLsp();

    return () => {
      lsp.didClose(language, path).catch(console.error);
    };
  }, [path, language]);

  const deferredContent = React.useDeferredValue(content);
  const highlightedHTML = React.useMemo(() => {
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(deferredContent, { language, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(deferredContent).value;
    } catch (e) {
      return deferredContent;
    }
  }, [deferredContent, language]);

  const linesCount = deferredContent.split("\n").length;
  const lineNumbers = React.useMemo(() => {
    return Array.from({ length: Math.max(1, linesCount) }, (_, i) => i + 1);
  }, [linesCount]);

  return (
    <div className="relative w-full h-full flex bg-transparent overflow-hidden">      {isSearchOpen && (
        <SearchWidget
          onSearch={setSearchQuery}
          onClose={() => {
            setIsSearchOpen(false);
            setSearchQuery("");
            setSearchMatches([]);
          }}
          onNext={handleSearchNext}
          onPrev={handleSearchPrev}
          totalMatches={searchMatches.length}
          currentIndex={currentMatchIndex}
        />
      )}

      {/* 侧边栏（行号槽） */}
      <div className="w-[48px] shrink-0 bg-transparent border-r border-black/5 dark:border-white/5 flex flex-col items-end py-4 px-2 select-none overflow-hidden">
        <div
          ref={lineNumbersRef}
          className="flex flex-col items-end"
          style={{
            fontFamily: "var(--EditorFontFamily)",
            fontSize: "var(--EditorFontSize)",
            lineHeight: "var(--EditorLineHeight)",
            color: "var(--TextMuted)",
            opacity: 0.7,
          }}
        >
          {lineNumbers.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      </div>

      {}
      <div
        className="relative flex-1 overflow-auto aurona-scroll"
        onScroll={(e) => {
          if (lineNumbersRef.current) {
            lineNumbersRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
          }
        }}
        onClick={() => setCompletions([])}
      >
        <div className="relative inline-block min-w-full p-4">
          <pre
            className="m-0 p-0 pointer-events-none z-0 hljs"
            style={{
              fontFamily: "var(--EditorFontFamily)",
              fontSize: "var(--EditorFontSize)",
              lineHeight: "var(--EditorLineHeight)",
              whiteSpace: "pre",
              tabSize: 2,
              textShadow: "0 1px 2px rgba(0,0,0,0.1)",
            }}
            dangerouslySetInnerHTML={{
              __html: highlightedHTML + (content.endsWith("\n") ? "\n" : ""),
            }}
          />

          <div className="absolute top-0 left-0 w-full h-full m-0 p-4 pointer-events-none z-[5] overflow-hidden">
            {}
            <div
              style={{
                position: "absolute",
                top: `${(currentLine - 1) * lineHeightRef.current + 16}px`,
                left: 0,
                width: "100%",
                height: `${lineHeightRef.current}px`,
                backgroundColor: "var(--EditorActiveLineBg)",
                borderTop: "1px solid var(--EditorActiveLineBorder)",
                borderBottom: "1px solid var(--EditorActiveLineBorder)",
                zIndex: -1,
                pointerEvents: "none",
              }}
            />

            {}
            {searchMatches.map((index, i) => {
              const { line, char } = getLineAndChar(index);

              const top = line * lineHeightRef.current + 16;
              const left = char * charWidthRef.current;
              const width = searchQuery.length * charWidthRef.current;

              const isCurrent = i === currentMatchIndex;

              return (
                <div
                  key={`search-${i}`}
                  style={{
                    position: "absolute",
                    top: `${top}px`,
                    left: `${left}px`,
                    width: `${width}px`,
                    height: `${lineHeightRef.current}px`,
                    backgroundColor: isCurrent
                      ? "rgba(255, 165, 0, 0.5)"
                      : "rgba(255, 255, 0, 0.2)",
                    borderRadius: "2px",
                  }}
                />
              );
            })}

            {}
            {diagnostics.map((diag, i) => {
              if (!diag.range) return null;
              const top = diag.range.start.line * lineHeightRef.current + 16;
              const left = diag.range.start.character * charWidthRef.current;
              const width = Math.max(
                charWidthRef.current,
                (diag.range.end.character - diag.range.start.character) * charWidthRef.current,
              );

              const isError = diag.severity === 1;
              const color = isError ? "rgba(239, 68, 68, 0.8)" : "rgba(234, 179, 8, 0.8)";

              return (
                <div
                  key={`diag-${i}`}
                  style={{
                    position: "absolute",
                    top: `${top}px`,
                    left: `${left}px`,
                    width: `${width}px`,
                    height: `${lineHeightRef.current}px`,
                    borderBottom: `2px wavy ${color}`,
                  }}
                />
              );
            })}
          </div>

          <ContextMenuRoot>
            <ContextMenuTrigger asChild>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onSelect={(e) => updateStatus(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
                onClick={(e) => updateStatus(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
                onKeyUp={(e) => updateStatus(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                spellCheck={false}
                className="absolute top-0 left-0 w-full h-full m-0 p-4 resize-none outline-none focus:outline-none focus:ring-0 focus:border-none border-none bg-transparent text-transparent caret-[var(--TextHighlight)] whitespace-pre overflow-hidden z-10"
                style={{
                  fontFamily: "var(--EditorFontFamily)",
                  fontSize: "var(--EditorFontSize)",
                  lineHeight: "var(--EditorLineHeight)",
                  tabSize: 2,
                  outline: "none",
                  boxShadow: "none",
                  border: "none",
                }}
              />
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
              <ContextMenuItem
                label="撤销"
                onSelect={() => document.execCommand("undo")}
              />
              <ContextMenuItem
                label="重做"
                onSelect={() => document.execCommand("redo")}
              />
              <ContextMenuDivider />
              <ContextMenuItem
                label="剪切"
                onSelect={() => document.execCommand("cut")}
              />
              <ContextMenuItem
                label="复制"
                onSelect={() => document.execCommand("copy")}
              />
              <ContextMenuItem
                label="粘贴"
                onSelect={() => document.execCommand("paste")}
              />
              <ContextMenuDivider />
              <ContextMenuItem
                label="全选"
                onSelect={() => textareaRef.current?.select()}
              />
            </ContextMenuContent>
          </ContextMenuRoot>
        </div>
      </div>

      <AutocompleteMenu
        x={completionPos.x}
        y={completionPos.y}
        items={completions}
        selectedIndex={completionIndex}
        onSelect={handleAutocompleteSelect}
      />

      {hoverTooltip && (
        <div
          className="fixed z-50 p-2.5 text-[12px] bg-black/80 dark:bg-white/90 text-white dark:text-black backdrop-blur-md rounded-xl shadow-xl border border-white/10 max-w-[400px] whitespace-pre-wrap break-words pointer-events-none transition-opacity"
          style={{ left: hoverTooltip.x, top: hoverTooltip.y }}
        >
          {hoverTooltip.text}
        </div>
      )}
    </div>
  );
});
