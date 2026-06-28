import { useEffect, useState } from "react";
import { EditorAdapter } from "../Features/Editor/EditorAdapter";
import { EMPTY_EDITOR_STATUS, EditorStatus } from "../Features/Editor/IEditorEngine";

const formatLanguage = (language: string) => {
  const labels: Record<string, string> = {
    plaintext: "Plain Text",
    typescript: "TypeScript",
    javascript: "JavaScript",
    json: "JSON",
    css: "CSS",
    scss: "SCSS",
    html: "HTML",
    markdown: "Markdown",
    rust: "Rust",
    python: "Python",
    java: "Java",
    cpp: "C++",
    go: "Go",
    shell: "Shell",
    powershell: "PowerShell",
    yaml: "YAML",
    toml: "TOML",
    sql: "SQL",
    xml: "XML",
  };
  return labels[language] ?? language;
};

export function StatusBar() {
  const [editorStatus, setEditorStatus] = useState<EditorStatus>(EMPTY_EDITOR_STATUS);

  useEffect(() => {
    return EditorAdapter.onStatusChange(setEditorStatus);
  }, []);

  return (
    <footer className="flex h-[var(--StatusBarHeight)] shrink-0 items-center bg-transparent px-4 text-xs text-[var(--TextMuted)] font-medium overflow-hidden">
      <div className="flex items-center gap-4 min-w-0">
        <span className="cursor-default truncate">
          {editorStatus.errors} 错误, {editorStatus.warnings} 警告
        </span>
        {editorStatus.hasEditor && (
          <span className="cursor-default truncate">
            行 {editorStatus.line}, 列 {editorStatus.column}
            {editorStatus.selectionLength > 0 ? ` (${editorStatus.selectionLength} 已选)` : ""}
          </span>
        )}
      </div>
      <div className="ml-auto hidden sm:flex items-center gap-4 min-w-0">
        {editorStatus.hasEditor && (
          <>
            <span className="cursor-default">{editorStatus.encoding}</span>
            <span className="cursor-default">{editorStatus.lineEnding}</span>
            <span className="cursor-default">
              {editorStatus.insertSpaces ? "空格" : "Tab"}: {editorStatus.tabSize}
            </span>
            <span className="cursor-default truncate">{formatLanguage(editorStatus.language)}</span>
          </>
        )}
      </div>
    </footer>
  );
}
