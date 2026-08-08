import { fileUriToPath, pathsEqual } from "../Shared/Utils/UriUtils";

export interface DiagnosticPosition {
  line: number;
  character: number;
}

export interface DiagnosticRange {
  start: DiagnosticPosition;
  end: DiagnosticPosition;
}

export interface DiagnosticRelatedInformation {
  location: { uri: string; range: DiagnosticRange };
  message: string;
}

export interface DiagnosticItem {
  range: DiagnosticRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
  tags?: number[];
  relatedInformation?: DiagnosticRelatedInformation[];
}

export interface DiagnosticDocument {
  uri: string;
  version?: number;
  diagnostics: readonly DiagnosticItem[];
}

export interface ProblemViewItem extends DiagnosticItem {
  uri: string;
  key: string;
}

/** 将全部诊断摊平为可渲染条目；file 作用域按活动文件过滤，workspace 返回全部。 */
export function collectProblems(
  documents: readonly DiagnosticDocument[],
  scope: "file" | "workspace",
  activeFilePath: string | null | undefined,
): ProblemViewItem[] {
  const all = documents.flatMap((document) =>
    document.diagnostics.map((diagnostic, index) => ({
      ...diagnostic,
      uri: document.uri,
      key: `${document.uri}-${diagnostic.source ?? "aurona"}-${diagnostic.range.start.line}-${diagnostic.range.start.character}-${index}`,
    })),
  );
  if (scope === "file") {
    return activeFilePath
      ? all.filter((problem) => pathsEqual(fileUriToPath(problem.uri), activeFilePath))
      : [];
  }
  return all;
}

type Listener = () => void;

class DiagnosticsServiceImpl {
  private readonly documents = new Map<string, DiagnosticDocument>();
  private readonly listeners = new Set<Listener>();
  private revision = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  getAll(): readonly DiagnosticDocument[] {
    return [...this.documents.values()];
  }

  get(uri: string | undefined): DiagnosticDocument | undefined {
    return uri ? this.documents.get(uri) : undefined;
  }

  update(document: DiagnosticDocument): void {
    if (document.diagnostics.length === 0) this.documents.delete(document.uri);
    else this.documents.set(document.uri, document);
    this.emit();
  }

  clear(uri?: string): void {
    if (uri) this.documents.delete(uri);
    else this.documents.clear();
    this.emit();
  }

  private emit(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}

export const DiagnosticsService = new DiagnosticsServiceImpl();
