import React, { useCallback, useEffect, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-css";
import "prismjs/components/prism-json";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-markdown";
import { EditorAdapter } from "./EditorAdapter";
import { EditorStatus, EditorStatusListener, IEditorEngine } from "./IEditorEngine";
import { LspClient } from "./LspClient";
import { EventBus } from "../../Core/EventBus";

// Prismjs custom simple theme
const prismTheme = `
code[class*="language-"], pre[class*="language-"] {
  color: var(--ColorTextHighlight);
  text-shadow: none;
  font-family: var(--EditorFontFamily);
  font-size: var(--EditorFontSize);
  line-height: var(--EditorLineHeight);
  direction: ltr;
  text-align: left;
  white-space: pre;
  word-spacing: normal;
  word-break: normal;
  tab-size: 2;
  hyphens: none;
}
/* 隐形滚动条定制 */
.aurona-scroll::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}
.aurona-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.aurona-scroll::-webkit-scrollbar-thumb {
  background-color: var(--ColorPanelBorder);
  border-radius: 10px;
  border: 3px solid transparent;
  background-clip: padding-box;
}
.aurona-scroll::-webkit-scrollbar-thumb:hover {
  background-color: var(--ColorMuted);
}
.token.comment, .token.prolog, .token.doctype, .token.cdata { color: #8b949e; }
.token.punctuation { color: #c9d1d9; }
.token.namespace { opacity: .7; }
.token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted { color: #79c0ff; }
.token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #a5d6ff; }
.token.operator, .token.entity, .token.url, .language-css .token.string, .style .token.string { color: #c9d1d9; }
.token.atrule, .token.attr-value, .token.keyword { color: #ff7b72; }
.token.function, .token.class-name { color: #d2a8ff; }
.token.regex, .token.important, .token.variable { color: #ffa657; }
`;

export type AuronaEngineProps = {
  value: string;
  language: string;
  isActive?: boolean;
  onChange?: (value: string) => void;
  path?: string;
};

export function AuronaEngine({
  value,
  language,
  isActive = true,
  onChange,
  path,
}: AuronaEngineProps) {
  const [content, setContent] = useState(value);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [hoverTooltip, setHoverTooltip] = useState<{x: number, y: number, text: string} | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const charWidthRef = useRef<number>(8.4);
  const lineHeightRef = useRef<number>(21);
  const contentRef = useRef(value);
  const onChangeRef = useRef(onChange);
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

  const engineImplRef = useRef<IEditorEngine | null>(null);
  const statusListenersRef = useRef(new Set<EditorStatusListener>());
  const statusRef = useRef<EditorStatus>({
    hasEditor: true,
    path,
    language,
    line: 1,
    column: 1,
    selectionLength: 0,
    tabSize: 2,
    insertSpaces: true,
    encoding: "UTF-8",
    lineEnding: "LF",
    errors: 0,
    warnings: 0,
    markers: [],
  });

  useEffect(() => {
    setContent(value);
  }, [value]);

  const emitStatus = useCallback((status: EditorStatus) => {
    statusRef.current = status;
    statusListenersRef.current.forEach((listener) => listener(status));
  }, []);

  const updateStatus = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const textBeforeCursor = el.value.substring(0, el.selectionStart);
    const lines = textBeforeCursor.split("\n");
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    
    emitStatus({
      ...statusRef.current,
      line,
      column,
      selectionLength: Math.abs(el.selectionEnd - el.selectionStart),
    });
  }, [emitStatus]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    onChange?.(newContent);
    updateStatus();

    if (path && language) {
      LspClient.getInstance().didChange(language, path, newContent);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newText = content.substring(0, start) + "  " + content.substring(end);
      setContent(newText);
      onChange?.(newText);
      setTimeout(() => {
        el.selectionStart = el.selectionEnd = start + 2;
        updateStatus();
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
    
    // Account for padding (p-4 = 16px)
    const line = Math.floor((y - 16) / lineHeightRef.current);
    const character = Math.floor((x - 16) / charWidthRef.current);
    
    if (line >= 0 && character >= 0) {
      const diag = diagnostics.find(d => 
        line >= d.range.start.line && line <= d.range.end.line &&
        character >= d.range.start.character && character <= d.range.end.character
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
          setTimeout(() => {
            el.selectionStart = el.selectionEnd = start + text.length;
            updateStatus();
          }, 0);
        } else {
          const newText = curContent + text;
          setContent(newText);
          onChangeRef.current?.(newText);
          updateStatus();
        }
      },
      replaceRange: (startLine: number, endLine: number, newText: string) => {
        const el = textareaRef.current;
        if (!el) return;
        const lines = contentRef.current.split("\n");
        const newLines = [
          ...lines.slice(0, startLine - 1),
          newText,
          ...lines.slice(endLine)
        ];
        const resText = newLines.join("\n");
        setContent(resText);
        onChangeRef.current?.(resText);
        updateStatus();
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
  }, [isActive, updateStatus]);

  useEffect(() => {
    if (isActive) updateStatus();
  }, [isActive, updateStatus]);

  // LSP 初始化与文档打开同步
  useEffect(() => {
    if (!path || !language) return;
    const lsp = LspClient.getInstance();
    
    const initLsp = async () => {
      await lsp.startServer(language);
      await lsp.didOpen(language, path, content);
    };
    
    initLsp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, language]);

  // fallback to generic plain text if language is missing
  const grammar = Prism.languages[language === 'typescript' ? 'typescript' : language] || Prism.languages.javascript;
  const highlightedHTML = Prism.highlight(content, grammar, language);

  const linesCount = content.split('\n').length;
  const lineNumbers = Array.from({ length: Math.max(1, linesCount) }, (_, i) => i + 1);

  return (
    <div className="relative w-full h-full flex bg-transparent overflow-hidden">
      <style>{prismTheme}</style>
      
      {/* 侧边栏（行号槽） */}
      <div className="w-[48px] shrink-0 bg-transparent border-r border-black/5 dark:border-white/5 flex flex-col items-end py-4 px-2 select-none overflow-hidden">
        <div 
          ref={lineNumbersRef}
          className="flex flex-col items-end"
          style={{ 
            fontFamily: "var(--EditorFontFamily)",
            fontSize: "var(--EditorFontSize)",
            lineHeight: "var(--EditorLineHeight)",
            color: "var(--ColorMuted)",
            opacity: 0.7,
          }}
        >
          {lineNumbers.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      </div>

      {/* 编辑器本体 */}
      <div 
        className="relative flex-1 overflow-auto aurona-scroll"
        onScroll={(e) => {
          if (lineNumbersRef.current) {
            lineNumbersRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
          }
        }}
      >
        <div className="relative inline-block min-w-full p-4">
          <pre
            className="m-0 p-0 pointer-events-none z-0"
            style={{
              fontFamily: "var(--EditorFontFamily)",
              fontSize: "var(--EditorFontSize)",
              lineHeight: "var(--EditorLineHeight)",
              whiteSpace: "pre",
              tabSize: 2,
              textShadow: "0 1px 2px rgba(0,0,0,0.1)", /* 增加一点发光投影保证裸背时的可读性 */
            }}
            dangerouslySetInnerHTML={{ __html: highlightedHTML + (content.endsWith('\n') ? '\n' : '') }}
          />

          <div className="absolute top-0 left-0 w-full h-full m-0 p-4 pointer-events-none z-[5] overflow-hidden">
            {diagnostics.map((diag, i) => {
              const top = diag.range.start.line * lineHeightRef.current;
              const left = diag.range.start.character * charWidthRef.current;
              const width = Math.max(charWidthRef.current, (diag.range.end.character - diag.range.start.character) * charWidthRef.current);
              
              // LSP severity: 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
              const isError = diag.severity === 1;
              const color = isError ? "rgba(239, 68, 68, 0.8)" : "rgba(234, 179, 8, 0.8)";
              
              return (
                <div 
                  key={i}
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

          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={updateStatus}
            onClick={updateStatus}
            onKeyUp={updateStatus}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            spellCheck={false}
            className="absolute top-0 left-0 w-full h-full m-0 p-4 resize-none outline-none border-none bg-transparent text-transparent caret-[var(--ColorTextHighlight)] whitespace-pre overflow-hidden z-10"
            style={{
              fontFamily: "var(--EditorFontFamily)",
              fontSize: "var(--EditorFontSize)",
              lineHeight: "var(--EditorLineHeight)",
              tabSize: 2,
            }}
          />
        </div>
      </div>
      
      {/* 悬停提示浮层 */}
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
}
