import { EventBus } from "../Foundation/EventBus";
import { LocaleService } from "../Foundation/I18n";
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

const fingerprintOf = (content: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

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
  /** 预览时各目标文件的内容指纹（key 为原生路径），应用前用于检测外部变化。 */
  fingerprints: Record<string, string>;
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
      throw new Error(LocaleService.translate("language.serverUnavailable"));
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

  /** Peek 定义（0.4.6）：与 goToDefinition 同源，但不跳转——
   *  把位置交给编辑器内嵌 Peek 浮层渲染，由用户选择是否跳转。 */
  async peekDefinition(
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
    if (locations.length > 0) {
      NavigationHistory.record({ path, line: line + 1, character: character + 1 });
      EventBus.emit("language:peek-locations", { locations });
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
    const fingerprints: Record<string, string> = {};
    for (const entry of entries) {
      const path = fileUriToPath(entry.uri) ?? entry.uri;
      let content = DocumentService.get(path)?.content;
      if (content === undefined) {
        content = await FileSystemCommands.readTextFile(path);
      }
      fingerprints[path] = fingerprintOf(content);
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
      fingerprints,
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
    await this.applyWorkspaceEditWithFingerprints(edit, undefined);
  }

  /**
   * 应用 WorkspaceEdit：
   * Phase 1 对全部目标做版本/指纹/内容校验，任何可预知错误都在修改前抛出；
   * Phase 2 已打开文档走编辑器会话，未打开文档安全写盘，失败显式抛出、绝不静默部分成功。
   */
  async applyWorkspaceEditWithFingerprints(
    edit: WorkspaceEdit,
    expectedFingerprints: Record<string, string> | undefined,
  ): Promise<void> {
    const grouped = new Map<
      string,
      { uri: string; version?: number | null; edits: LspTextEdit[] }
    >();
    for (const entry of this.textDocumentEdits(edit)) {
      const path = fileUriToPath(entry.uri) ?? entry.uri;
      const existing = grouped.get(path);
      if (existing) {
        if (
          entry.version !== undefined &&
          entry.version !== null &&
          existing.version !== undefined &&
          existing.version !== null &&
          existing.version !== entry.version
        ) {
          throw new Error(`Workspace edit version mismatch for ${path}`);
        }
        existing.edits.push(...entry.edits);
      } else {
        grouped.set(path, { uri: entry.uri, version: entry.version, edits: [...entry.edits] });
      }
    }

    const prepared: Array<{
      path: string;
      isOpen: boolean;
      applied: ReturnType<typeof applyLspTextEdits>;
    }> = [];
    for (const [path, entry] of grouped) {
      const document = DocumentService.get(path);
      const isOpen = document?.openState === "open";
      let content: string;
      if (isOpen) {
        if (
          entry.version !== undefined &&
          entry.version !== null &&
          document.version !== entry.version
        ) {
          throw new Error(`Workspace edit version mismatch for ${path}`);
        }
        content = document.content;
      } else {
        content = await FileSystemCommands.readTextFile(path);
      }
      const expected = expectedFingerprints?.[path];
      if (expected && fingerprintOf(content) !== expected) {
        throw new Error(`Workspace edit target changed since preview: ${path}`);
      }
      const normalizedEdits = entry.edits.map((textEdit) => ({
        ...textEdit,
        newText: this.normalizeEditNewText(content, textEdit.newText),
      }));
      prepared.push({
        path,
        isOpen,
        applied: applyLspTextEdits(content, normalizedEdits),
      });
    }

    for (const item of prepared) {
      if (item.isOpen) {
        await DocumentService.applyEdits(
          item.path,
          item.applied.documentEdits,
          item.applied.content,
        );
      } else {
        await FileSystemCommands.writeTextFile(item.path, item.applied.content);
        EventBus.emit("fs:changed", { type: "modified", paths: [item.path] });
      }
    }
  }

  private normalizeEditNewText(content: string, newText: string): string {
    if (content.includes("\r\n") && !newText.includes("\r\n")) {
      return newText.replace(/\n/g, "\r\n");
    }
    return newText;
  }

  private textDocumentEdits(edit: WorkspaceEdit) {
    const entries: Array<{ uri: string; version?: number | null; edits: LspTextEdit[] }> = [];
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
      entries.push({ uri, edits });
    }
    for (const change of edit.documentChanges ?? []) {
      if ("kind" in change) {
        throw new Error(`Workspace resource operation is not supported yet: ${change.kind}`);
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
