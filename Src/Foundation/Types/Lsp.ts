/** LSP completion item projection shared by the language service and the UI. */
export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
  filterText?: string;
  commitCharacters?: string[];
  textEdit?: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  };
  additionalTextEdits?: Array<{
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  }>;
  data?: unknown;
}
