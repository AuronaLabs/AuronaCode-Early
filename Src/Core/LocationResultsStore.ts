import { FileSystemCommands } from "../Foundation/IPC/FileSystemCommands";
import { fileUriToPath } from "../Shared/Utils/UriUtils";
import type { LspLocation } from "./Language/LspClient";

export type LocationResultsKind = "definition" | "references";

export interface LocationResultItem {
  id: string;
  path: string;
  line: number;
  character: number;
  preview: string;
  matchStart?: number;
  matchEnd?: number;
  previewLoading: boolean;
  rawStart: number;
  rawEnd: number;
}

export interface LocationResultsState {
  kind: LocationResultsKind;
  title: string;
  requestId: string;
  items: LocationResultItem[];
}

class LocationResultsStoreImpl {
  private state: LocationResultsState | null = null;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): LocationResultsState | null => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async open(
    kind: LocationResultsKind,
    title: string,
    locations: readonly LspLocation[],
  ): Promise<void> {
    const requestId = `location-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const items: LocationResultItem[] = locations.map((location, index) => ({
      id: `${kind}-${requestId}-${index}`,
      path: fileUriToPath(location.uri) ?? location.uri,
      line: location.range.start.line + 1,
      character: location.range.start.character + 1,
      preview: "",
      previewLoading: true,
      rawStart: location.range.start.character,
      rawEnd: location.range.end.character,
    }));
    this.publish({ kind, title, requestId, items });
    await this.loadPreviews(requestId);
  }

  clear(): void {
    this.publish(null);
  }

  private async loadPreviews(requestId: string): Promise<void> {
    const state = this.state;
    if (!state || state.requestId !== requestId) return;
    const files = [...new Set(state.items.map((item) => item.path))];
    for (const path of files) {
      let lines: string[] = [];
      try {
        const text = await FileSystemCommands.readTextFile(path);
        lines = text.split(/\r?\n/);
      } catch {
        lines = [];
      }
      if (!this.state || this.state.requestId !== requestId) return;
      const items = this.state.items.map((item) => {
        if (item.path !== path) return item;
        const raw = lines[item.line - 1] ?? "";
        const preview = raw.trim();
        const offset = raw.length - raw.trimStart().length;
        const matchStart = Math.max(0, item.rawStart - offset);
        const matchEnd = Math.min(preview.length, item.rawEnd - offset);
        return {
          ...item,
          preview,
          previewLoading: false,
          matchStart: matchEnd > matchStart ? matchStart : undefined,
          matchEnd: matchEnd > matchStart ? matchEnd : undefined,
        };
      });
      this.publish({ ...this.state, items });
    }
  }

  private publish(state: LocationResultsState | null): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export const LocationResultsStore = new LocationResultsStoreImpl();
