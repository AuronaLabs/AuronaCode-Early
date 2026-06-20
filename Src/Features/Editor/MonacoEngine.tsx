import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import { EditorAdapter } from "./EditorAdapter";
import { EditorStatus, EditorStatusListener, IEditorEngine } from "./IEditorEngine";
import { EventBus } from "../../Core/EventBus";

export type MonacoEngineProps = {
  value: string;
  language: string;
  isActive?: boolean;
  onChange?: (value: string) => void;
  fontSize?: number;
  lineHeight?: number;
  path?: string;
};

export function MonacoEngine({
  value,
  language,
  isActive = true,
  onChange,
  fontSize = 14,
  lineHeight = 24,
  path,
}: MonacoEngineProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const engineImplRef = useRef<IEditorEngine | null>(null);
  const statusListenersRef = useRef(new Set<EditorStatusListener>());
  const statusRef = useRef<EditorStatus>({
    hasEditor: false,
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

  const emitStatus = useCallback((status: EditorStatus) => {
    statusRef.current = status;
    statusListenersRef.current.forEach((listener) => listener(status));
  }, []);

  const collectStatus = useCallback((): EditorStatus => {
    const editor = editorRef.current;
    const monacoInstance = monacoRef.current;
    const model = editor?.getModel();
    const position = editor?.getPosition();
    const selection = editor?.getSelection();
    const options = model?.getOptions();
    const markers = model && monacoInstance ? monacoInstance.editor.getModelMarkers({}) : [];
    const text = model?.getValue() ?? "";

    return {
      hasEditor: !!editor,
      path,
      language,
      line: position?.lineNumber ?? 1,
      column: position?.column ?? 1,
      selectionLength: selection && model ? model.getValueInRange(selection).length : 0,
      tabSize: options?.tabSize ?? 2,
      insertSpaces: options?.insertSpaces ?? true,
      encoding: "UTF-8",
      lineEnding: text.includes("\r\n") ? "CRLF" : "LF",
      errors: markers.filter((marker) => marker.severity === monacoInstance?.MarkerSeverity.Error).length,
      warnings: markers.filter((marker) => marker.severity === monacoInstance?.MarkerSeverity.Warning).length,
      markers: markers.map((m) => ({
        message: m.message,
        severity: m.severity,
        line: m.startLineNumber,
        column: m.startColumn,
        source: m.source,
      })),
    };
  }, [language, path]);

  const debounceTimerRef = useRef<number | null>(null);

  const refreshStatus = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      emitStatus(collectStatus());
      debounceTimerRef.current = null;
    }, 150);
  }, [collectStatus, emitStatus]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      monacoRef.current?.editor.setTheme(isDark ? "AuronaDark" : "AuronaLight");
      editorRef.current?.layout();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-density"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleResize = () => editorRef.current?.layout();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!editorRef.current || !isActive) return;
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.layout();
      refreshStatus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fontSize, isActive, lineHeight, refreshStatus]);

  useEffect(() => {
    if (isActive) {
      if (engineImplRef.current) EditorAdapter.bindEngine(engineImplRef.current);
      refreshStatus();
    }
  }, [isActive, language, path, refreshStatus]);

  useEffect(() => {
    const handleAction = (action: string) => {
      if (!editorRef.current || !isActive) return;

      switch (action) {
        case "undo":
          editorRef.current.trigger("menu", "undo", null);
          break;
        case "redo":
          editorRef.current.trigger("menu", "redo", null);
          break;
        case "cut":
          editorRef.current.trigger("menu", "editor.action.clipboardCutAction", null);
          break;
        case "copy":
          editorRef.current.trigger("menu", "editor.action.clipboardCopyAction", null);
          break;
        case "paste":
          editorRef.current.trigger("menu", "editor.action.clipboardPasteAction", null);
          break;
        case "selectAll":
          editorRef.current.trigger("menu", "editor.action.selectAll", null);
          break;
      }
    };

    return EventBus.on("editor:action", handleAction);
  }, [isActive]);

  const handleEditorMount: OnMount = useCallback(
    (editor, monacoInstance) => {
      monacoRef.current = monacoInstance;
      editorRef.current = editor;

      const isDark = document.documentElement.classList.contains("dark");
      monacoInstance.editor.setTheme(isDark ? "AuronaDark" : "AuronaLight");

      const engineImpl: IEditorEngine = {
        getText: () => editor.getValue(),
        getSelectionText: () => {
          const selection = editor.getSelection();
          const model = editor.getModel();
          return selection && model ? model.getValueInRange(selection) : "";
        },
        insertCode: (text: string) => {
          const position = editor.getPosition();
          if (!position) return;

          editor.executeEdits("Agent", [
            {
              range: new monacoInstance.Range(position.lineNumber, position.column, position.lineNumber, position.column),
              text,
              forceMoveMarkers: true,
            },
          ]);
          refreshStatus();
        },
        replaceRange: (startLine: number, endLine: number, newText: string) => {
          editor.executeEdits("Agent", [
            {
              range: new monacoInstance.Range(startLine, 1, endLine, 9999),
              text: newText,
              forceMoveMarkers: true,
            },
          ]);
          refreshStatus();
        },
        getStatus: () => statusRef.current,
        onStatusChange: (listener: EditorStatusListener) => {
          statusListenersRef.current.add(listener);
          listener(statusRef.current);
          return () => statusListenersRef.current.delete(listener);
        },
      };

      engineImplRef.current = engineImpl;
      if (isActive) EditorAdapter.bindEngine(engineImpl);

      editor.onContextMenu((event) => {
        event.event.preventDefault();
        setContextMenu({ x: event.event.posx, y: event.event.posy });
      });

      const disposables = [
        editor.onDidChangeCursorPosition(refreshStatus),
        editor.onDidChangeCursorSelection(refreshStatus),
        editor.onDidChangeModelContent(refreshStatus),
        editor.onDidChangeModelOptions(refreshStatus),
        monacoInstance.editor.onDidChangeMarkers(refreshStatus),
      ];

      refreshStatus();

      editor.onDidDispose(() => {
        disposables.forEach((disposable) => disposable.dispose());
        EditorAdapter.unbindEngine(engineImpl);
      });
    },
    [refreshStatus],
  );

  return (
    <>
      <Editor
        height="100%"
        language={language}
        theme="AuronaLight"
        value={value}
        onChange={(nextValue) => onChange?.(nextValue ?? "")}
        onMount={handleEditorMount}
        beforeMount={(monacoInstance) => {
          monacoInstance.editor.defineTheme("AuronaLight", {
            base: "vs",
            inherit: true,
            rules: [],
            colors: {
              "editor.background": "#ffffff00",
              "minimap.background": "#ffffff00",
              "editor.lineHighlightBackground": "#00000004",
              "editorLineNumber.foreground": "#94a3b8",
              "editorIndentGuide.background": "#e2e8f080",
              "editorIndentGuide.activeBackground": "#94a3b8",
              "editor.selectionBackground": "#e2e8f0",
            },
          });

          monacoInstance.editor.defineTheme("AuronaDark", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: {
              "editor.background": "#00000000",
              "minimap.background": "#00000000",
            },
          });
        }}
        options={{
          contextmenu: false,
          folding: false,
          lightbulb: { enabled: false as any },
          minimap: { enabled: true },
          quickSuggestions: false,
          parameterHints: { enabled: false },
          snippetSuggestions: "none",
          suggestOnTriggerCharacters: false,
          wordBasedSuggestions: "off",
          hover: { enabled: false },
          links: false,
          colorDecorators: false,
          fontSize,
          lineHeight,
          fontFamily: "JetBrains Mono, Consolas, 'Courier New', monospace",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 4, bottom: 8 },
          renderWhitespace: "selection",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
      />

      {contextMenu && (
        <div
          className="fixed bg-[var(--ColorEditor)] border border-[var(--ColorPanelBorder)] shadow-2xl rounded-xl p-1 z-[9999] flex flex-col min-w-[180px] animate-in fade-in zoom-in-95 duration-100"
          style={{ top: Math.min(contextMenu.y, window.innerHeight - 220), left: Math.min(contextMenu.x, window.innerWidth - 200) }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors" onClick={() => { setContextMenu(null); editorRef.current?.trigger("menu", "undo", null); }}>
            撤销
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors" onClick={() => { setContextMenu(null); editorRef.current?.trigger("menu", "redo", null); }}>
            重做
          </button>
          <div className="h-px bg-[var(--ColorPanelBorder)] my-1 mx-1" />
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors" onClick={() => { setContextMenu(null); editorRef.current?.trigger("menu", "editor.action.clipboardCutAction", null); }}>
            剪切
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors" onClick={() => { setContextMenu(null); editorRef.current?.trigger("menu", "editor.action.clipboardCopyAction", null); }}>
            复制
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors" onClick={() => { setContextMenu(null); editorRef.current?.trigger("menu", "editor.action.clipboardPasteAction", null); }}>
            粘贴
          </button>
          <div className="h-px bg-[var(--ColorPanelBorder)] my-1 mx-1" />
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors" onClick={() => { setContextMenu(null); editorRef.current?.trigger("menu", "editor.action.selectAll", null); }}>
            全选
          </button>
        </div>
      )}
    </>
  );
}
