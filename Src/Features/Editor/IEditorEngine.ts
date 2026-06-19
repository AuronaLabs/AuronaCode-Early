export type EditorMarker = {
  message: string;
  severity: number;
  line: number;
  column: number;
  source?: string;
};

export type EditorStatus = {
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
};

export type EditorStatusListener = (status: EditorStatus) => void;

export interface IEditorEngine {
  getText(): string;
  getSelectionText(): string;
  insertCode(text: string, atCursor?: boolean): void;
  replaceRange(startLine: number, endLine: number, newText: string): void;
  getStatus(): EditorStatus;
  onStatusChange(listener: EditorStatusListener): () => void;
}

export const EMPTY_EDITOR_STATUS: EditorStatus = {
  hasEditor: false,
  language: "Plain Text",
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
