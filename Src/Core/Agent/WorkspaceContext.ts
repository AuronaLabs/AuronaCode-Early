import { type DiagnosticItem, DiagnosticsService } from "../DiagnosticsService";
import { DocumentService } from "../DocumentService";
import { EditorAdapter } from "../Editor/EditorAdapter";
import { WorkspaceService } from "../WorkspaceService";

export interface WorkspaceContextFile {
  path: string;
  language: string;
  isDirty: boolean;
}

export interface WorkspaceContextDiagnostic extends DiagnosticItem {
  uri: string;
}

export interface WorkspaceContext {
  projectRoot: string | null;
  activeFile: string | null;
  openedFiles: WorkspaceContextFile[];
  language: string;
  selection: string;
  cursor: { line: number; column: number };
  diagnostics: WorkspaceContextDiagnostic[];
  recentChanges: Array<{
    path: string;
    version: number;
    isDirty: boolean;
    origin?: string;
  }>;
}

export interface WorkspaceContextProvider {
  getContext(): WorkspaceContext;
}

/** Builds a small, synchronous snapshot for an Agent turn. It deliberately avoids indexing the
 * workspace; callers can request richer information through the normal read/search tools. */
export class DefaultWorkspaceContextProvider implements WorkspaceContextProvider {
  getContext(): WorkspaceContext {
    const status = EditorAdapter.getStatus();
    const path = status.path ?? null;
    const documents = DocumentService.getAll();
    const openedFiles = documents
      .filter((document) => document.openState === "open")
      .map((document) => ({
        path: document.path,
        language: document.languageId,
        isDirty: document.isDirty,
      }));
    const diagnostics = DiagnosticsService.getAll().flatMap((document) =>
      document.diagnostics.map((diagnostic) => ({ ...diagnostic, uri: document.uri })),
    );
    return {
      projectRoot: WorkspaceService.getCurrent().primaryRoot,
      activeFile: path,
      openedFiles,
      language: status.hasEditor
        ? status.language
        : path
          ? (DocumentService.get(path)?.languageId ?? "unknown")
          : "unknown",
      selection: EditorAdapter.getSelectionText(),
      cursor: { line: status.line, column: status.column },
      diagnostics,
      recentChanges: documents
        .filter((document) => document.isDirty || document.changeOrigin === "external")
        .map((document) => ({
          path: document.path,
          version: document.version,
          isDirty: document.isDirty,
          origin: document.changeOrigin,
        })),
    };
  }
}

export const WorkspaceContextService: WorkspaceContextProvider =
  new DefaultWorkspaceContextProvider();

export function getWorkspaceContext(): WorkspaceContext {
  return WorkspaceContextService.getContext();
}
