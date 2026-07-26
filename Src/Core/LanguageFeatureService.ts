import { LspClient, type LspLocation } from "../Features/Editor/LspClient";
import { EventBus } from "../Foundation/EventBus";
import { DiagnosticsService } from "./DiagnosticsService";
import { DocumentService } from "./DocumentService";
import { applyLspTextEdits, type LspTextEdit } from "./Language/TextEdits";
import { OutputService } from "./OutputService";

interface LocationLink {
  targetUri: string;
  targetSelectionRange: LspLocation["range"];
}

export interface WorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<
    | { textDocument: { uri: string; version?: number | null }; edits: LspTextEdit[] }
    | { kind: string }
  >;
}

export interface WorkspaceEditPreview {
  files: Array<{ uri: string; editCount: number }>;
  totalEdits: number;
}

export interface LanguageCodeAction {
  title: string;
  kind?: string;
  disabled?: { reason: string };
  edit?: WorkspaceEdit;
  command?: { command: string; arguments?: unknown[] };
  data?: unknown;
}

const uriToPath = (uri: string): string => {
  const url = new URL(uri);
  let path = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  if (url.host) path = `//${url.host}${path}`;
  return path.replace(/\//g, "\\");
};

class LanguageFeatureServiceImpl {
  async formatDocument(path: string, language: string): Promise<void> {
    const document = DocumentService.get(path);
    if (!document) throw new Error("The active document is not open");
    const edits = (await LspClient.getInstance().formatDocument(language, path)) as LspTextEdit[];
    if (!edits?.length) return;
    const applied = applyLspTextEdits(document.content, edits);
    await DocumentService.applyEdits(path, applied.documentEdits, applied.content);
  }

  async goToDefinition(
    path: string,
    language: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    const response = await LspClient.getInstance().getDefinition(language, path, line, character);
    const values = response ? (Array.isArray(response) ? response : [response]) : [];
    const locations = values.map((value: LspLocation | LocationLink) =>
      "targetUri" in value ? { uri: value.targetUri, range: value.targetSelectionRange } : value,
    );
    if (locations.length === 1) {
      const location = locations[0];
      EventBus.emit("editor:reveal-location", {
        path: uriToPath(location.uri),
        line: location.range.start.line + 1,
      });
    } else {
      this.writeLocations("Definitions", locations);
    }
    return locations;
  }

  async findReferences(
    path: string,
    language: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    const locations = await LspClient.getInstance().getReferences(language, path, line, character);
    this.writeLocations("References", locations);
    return locations;
  }

  async previewRename(
    path: string,
    language: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<{ edit: WorkspaceEdit; preview: WorkspaceEditPreview }> {
    await LspClient.getInstance().prepareRename(language, path, line, character);
    const edit = (await LspClient.getInstance().rename(
      language,
      path,
      line,
      character,
      newName,
    )) as WorkspaceEdit;
    return { edit, preview: this.describeWorkspaceEdit(edit) };
  }

  async getCodeActions(
    path: string,
    language: string,
    line: number,
    character: number,
  ): Promise<LanguageCodeAction[]> {
    const document = DocumentService.get(path);
    const diagnostics = document?.uri
      ? (DiagnosticsService.get(document.uri)?.diagnostics ?? [])
      : [];
    return LspClient.getInstance().getCodeActions(
      language,
      path,
      {
        start: { line, character },
        end: { line, character },
      },
      diagnostics,
    ) as Promise<LanguageCodeAction[]>;
  }

  async applyCodeAction(language: string, action: LanguageCodeAction): Promise<void> {
    if (action.disabled) throw new Error(action.disabled.reason);
    let resolved = action;
    if (!action.edit && action.data !== undefined) {
      resolved = (await LspClient.getInstance().resolveCodeAction(
        language,
        action,
      )) as LanguageCodeAction;
    }
    if (resolved.edit) await this.applyWorkspaceEdit(resolved.edit);
    if (resolved.command) {
      await LspClient.getInstance().executeCommand(
        language,
        resolved.command.command,
        resolved.command.arguments,
      );
    }
  }

  async applyWorkspaceEdit(edit: WorkspaceEdit): Promise<void> {
    const entries = this.textDocumentEdits(edit);
    const prepared: Array<{
      path: string;
      edits: ReturnType<typeof applyLspTextEdits>;
      expectedVersion?: number | null;
    }> = [];
    for (const entry of entries) {
      const path = uriToPath(entry.uri);
      const document = DocumentService.get(path);
      if (!document) {
        throw new Error(`Workspace edit targets a document that is not open: ${path}`);
      }
      if (
        entry.version !== undefined &&
        entry.version !== null &&
        document.version !== entry.version
      ) {
        throw new Error(`Workspace edit version mismatch for ${path}`);
      }
      prepared.push({
        path,
        edits: applyLspTextEdits(document.content, entry.edits),
        expectedVersion: entry.version,
      });
    }
    for (const item of prepared) {
      await DocumentService.applyEdits(item.path, item.edits.documentEdits, item.edits.content);
    }
  }

  private describeWorkspaceEdit(edit: WorkspaceEdit): WorkspaceEditPreview {
    const entries = this.textDocumentEdits(edit);
    return {
      files: entries.map((entry) => ({ uri: entry.uri, editCount: entry.edits.length })),
      totalEdits: entries.reduce((total, entry) => total + entry.edits.length, 0),
    };
  }

  private textDocumentEdits(edit: WorkspaceEdit) {
    const entries: Array<{ uri: string; version?: number | null; edits: LspTextEdit[] }> = [];
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
      entries.push({ uri, edits });
    }
    for (const change of edit.documentChanges ?? []) {
      if ("kind" in change) {
        throw new Error(`Workspace resource operation is not supported in 0.3.2: ${change.kind}`);
      }
      entries.push({
        uri: change.textDocument.uri,
        version: change.textDocument.version,
        edits: change.edits,
      });
    }
    return entries;
  }

  private writeLocations(title: string, locations: readonly LspLocation[]): void {
    OutputService.append("language-server", `${title}: ${locations.length} result(s)`);
    for (const location of locations) {
      OutputService.append(
        "language-server",
        `${uriToPath(location.uri)}:${location.range.start.line + 1}:${location.range.start.character + 1}`,
      );
    }
  }
}

export const LanguageFeatureService = new LanguageFeatureServiceImpl();
