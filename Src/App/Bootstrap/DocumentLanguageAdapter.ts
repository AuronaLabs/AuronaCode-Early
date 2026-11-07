import type { DocumentLanguageSync } from "../../Core/Documents";
import { LspClient } from "../../Core/Language/LspClient";

export const documentLanguageAdapter: DocumentLanguageSync = {
  open: (...args) => LspClient.getInstance().didOpen(...args),
  change: (...args) => LspClient.getInstance().didChange(...args),
  save: (...args) => LspClient.getInstance().didSave(...args),
  close: (...args) => LspClient.getInstance().didClose(...args),
  fileUri: (path) => LspClient.getInstance().getKnownFileUri(path),
};
