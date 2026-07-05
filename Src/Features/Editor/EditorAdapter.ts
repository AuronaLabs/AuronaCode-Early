import {
  type EditorStatus,
  type EditorStatusListener,
  EMPTY_EDITOR_STATUS,
  type IEditorEngine,
} from "./IEditorEngine";

class GlobalEditorAdapter {
  private activeEngine: IEditorEngine | null = null;
  private listeners = new Set<EditorStatusListener>();
  private disposeEngineStatus: (() => void) | null = null;

  public bindEngine(engine: IEditorEngine) {
    this.disposeEngineStatus?.();
    this.activeEngine = engine;
    this.disposeEngineStatus = engine.onStatusChange((status) => this.emitStatus(status));
    this.emitStatus(engine.getStatus());
  }

  public unbindEngine(engine?: IEditorEngine) {
    if (engine && this.activeEngine !== engine) return;
    this.disposeEngineStatus?.();
    this.disposeEngineStatus = null;
    this.activeEngine = null;
    this.emitStatus(EMPTY_EDITOR_STATUS);
  }

  public onStatusChange(listener: EditorStatusListener) {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getStatus(): EditorStatus {
    return this.activeEngine?.getStatus() ?? EMPTY_EDITOR_STATUS;
  }

  public getText(): string {
    return this.activeEngine?.getText() ?? "";
  }

  public getSelectionText(): string {
    return this.activeEngine?.getSelectionText() ?? "";
  }

  public insertCode(text: string, atCursor = true): void {
    this.activeEngine?.insertCode(text, atCursor);
  }

  public replaceRange(startLine: number, endLine: number, newText: string): void {
    this.activeEngine?.replaceRange(startLine, endLine, newText);
  }

  private emitStatus(status: EditorStatus) {
    this.listeners.forEach((listener) => listener(status));
  }
}

export const EditorAdapter = new GlobalEditorAdapter();
