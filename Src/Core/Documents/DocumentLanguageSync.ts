import type { TextEdit } from "../../Foundation/IPC/EditorCommands";

export interface DocumentLanguageSync {
  open(language: string, path: string, text: string, revision: number): Promise<void>;
  change(
    language: string,
    path: string,
    text: string,
    revision: number,
    edits: TextEdit[],
  ): Promise<void>;
  save(language: string, path: string): Promise<void>;
  close(language: string, path: string): Promise<void>;
  fileUri(path: string): string | undefined;
}

export const noLanguageSync: DocumentLanguageSync = {
  open: async () => undefined,
  change: async () => undefined,
  save: async () => undefined,
  close: async () => undefined,
  fileUri: () => undefined,
};
