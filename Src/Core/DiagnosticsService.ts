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
