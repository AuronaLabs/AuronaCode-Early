// 编辑器状态与接口定义（从 Features/Editor 迁出至基础层）

export interface EditorMarker {
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  line: number;
  column: number;
  source?: string;
}

export interface EditorStatus {
  hasEditor: boolean;
  path?: string;
  language: string;
  line: number;
  column: number;
  selectionLength: number;
  tabSize: number;
  insertSpaces: boolean;
  encoding: string;
  lineEnding: string;
  errors: number;
  warnings: number;
  markers: EditorMarker[];
}

export type EditorStatusListener = (status: EditorStatus) => void;

export const EMPTY_EDITOR_STATUS: EditorStatus = {
  hasEditor: false,
  language: "plaintext",
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
};

export interface IEditorEngine {
  getText(): string;
  getSelectionText(): string;
  insertCode(text: string, atCursor?: boolean): void;
  replaceRange(startLine: number, endLine: number, newText: string): void;
  getStatus(): EditorStatus;
  onStatusChange(listener: EditorStatusListener): () => void;
}
