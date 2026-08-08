import { EventBus } from "../Foundation/EventBus";
import { FileSystemCommands } from "../Foundation/IPC/FileSystemCommands";
import { fileUriToPath } from "../Shared/Utils/UriUtils";
import { DiagnosticsService } from "./DiagnosticsService";
import { DocumentService } from "./DocumentService";
import { LspClient, type LspFeature, type LspLocation } from "./Language/LspClient";
import { applyLspTextEdits, type LspTextEdit, positionToUtf16Offset } from "./Language/TextEdits";
import { LocationResultsStore } from "./LocationResultsStore";
import { NavigationHistory } from "./NavigationHistory";

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
  files: Array<{
    uri: string;
    editCount: number;
    edits: Array<{ line: number; oldText: string; newText: string }>;
  }>;
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

class LanguageFeatureServiceImpl {
  private ensureCapability(language: string, feature: LspFeature): void {
    if (!LspClient.getInstance().supports(language, feature)) {
      throw new Error("当前语言服务器未运行或不支持该功能");
    }
  }

  async formatDocument(path: string, language: string): Promise<void> {
    this.ensureCapability(language, "formatting");
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
    this.ensureCapability(language, "definition");
    const response = await LspClient.getInstance().getDefinition(language, path, line, character);
    const values = response ? (Array.isArray(response) ? response : [response]) : [];
    const locations = values.map((value: LspLocation | LocationLink) =>
      "targetUri" in value ? { uri: value.targetUri, range: value.targetSelectionRange } : value,
    );
    NavigationHistory.record({ path, line: line + 1, character: character + 1 });
    if (locations.length === 1) {
      const location = locations[0];
      const targetPath = fileUriToPath(location.uri);
      if (targetPath) {
        EventBus.emit("editor:reveal-location", {
          path: targetPath,
          line: location.range.start.line + 1,
        });
        NavigationHistory.record({
          path: targetPath,
          line: location.range.start.line + 1,
          character: location.range.start.character + 1,
        });
      }
    } else if (locations.length > 1) {
      await LocationResultsStore.open("definition", "Definitions", locations);
      EventBus.emit("language:open-location-results");
    }
    return locations;
  }

  async findReferences(
    path: string,
    language: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    this.ensureCapability(language, "references");
    const locations = await LspClient.getInstance().getReferences(language, path, line, character);
    if (locations.length > 0) {
      NavigationHistory.record({ path, line: line + 1, character: character + 1 });
      await LocationResultsStore.open("references", "References", locations);
      EventBus.emit("language:open-location-results");
    }
    return locations;
  }

  async previewRename(
    path: string,
    language: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<{ edit: WorkspaceEdit; preview: WorkspaceEditPreview }> {
    this.ensureCapability(language, "rename");
    await LspClient.getInstance().prepareRename(language, path, line, character);
    const edit = (await LspClient.getInstance().rename(
      language,
      path,
      line,
      character,
      newName,
    )) as WorkspaceEdit;
    return { edit, preview: await this.previewWorkspaceEdit(edit) };
  }

  /**
   * 共享的多文件修改预览：读取每个目标文档当前内容，计算每处修改的原文与新文。
   * Rename、Code Action 与未来的重构/AI 编辑共用同一套 Preview / Apply 机制。
   */
  async previewWorkspaceEdit(edit: WorkspaceEdit): Promise<WorkspaceEditPreview> {
    const entries = this.textDocumentEdits(edit);
    const files: WorkspaceEditPreview["files"] = [];
    for (const entry of entries) {
      const path = fileUriToPath(entry.uri) ?? entry.uri;
      let content = DocumentService.get(path)?.content;
      if (content === undefined) {
        content = await FileSystemCommands.readTextFile(path);
      }
      const edits = entry.edits
        .map((textEdit) => {
          const start = positionToUtf16Offset(content, textEdit.range.start);
          const end = positionToUtf16Offset(content, textEdit.range.end);
          return {
            line: textEdit.range.start.line + 1,
            oldText: content.slice(start, end),
            newText: textEdit.newText,
          };
        })
        .sort((left, right) => left.line - right.line);
      files.push({ uri: entry.uri, editCount: entry.edits.length, edits });
    }
    return {
      files,
      totalEdits: files.reduce((total, file) => total + file.editCount, 0),
    };
  }

  async previewCodeAction(
    language: string,
    action: LanguageCodeAction,
  ): Promise<{ edit: WorkspaceEdit; preview: WorkspaceEditPreview } | null> {
    if (action.disabled) throw new Error(action.disabled.reason);
    let resolved = action;
    if (!action.edit && action.data !== undefined) {
      resolved = (await LspClient.getInstance().resolveCodeAction(
        language,
        action,
      )) as LanguageCodeAction;
    }
    if (!resolved.edit) return null;
    return { edit: resolved.edit, preview: await this.previewWorkspaceEdit(resolved.edit) };
  }

  async getCodeActions(
    path: string,
    language: string,
    line: number,
    character: number,
  ): Promise<LanguageCodeAction[]> {
    this.ensureCapability(language, "codeAction");
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
      const path = fileUriToPath(entry.uri) ?? entry.uri;
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
}

export const LanguageFeatureService = new LanguageFeatureServiceImpl();
