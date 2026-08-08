export interface NavigationEntry {
  path: string;
  line: number;
  character?: number;
}

export interface NavigationHistoryState {
  entries: NavigationEntry[];
  cursor: number;
  canGoBack: boolean;
  canGoForward: boolean;
}

const MAX_ENTRIES = 100;

const sameEntry = (left: NavigationEntry, right: NavigationEntry) =>
  left.path === right.path &&
  left.line === right.line &&
  (left.character ?? 0) === (right.character ?? 0);

class NavigationHistoryImpl {
  private state: NavigationHistoryState = {
    entries: [],
    cursor: -1,
    canGoBack: false,
    canGoForward: false,
  };
  private readonly listeners = new Set<() => void>();

  getSnapshot(): NavigationHistoryState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 记录一次真实导航位置。会截断当前位置之后的 forward 历史，并去重连续相同位置。
   */
  record(entry: NavigationEntry): void {
    const current = this.state.entries[this.state.cursor];
    if (current && sameEntry(current, entry)) return;
    const entries = this.state.entries.slice(0, this.state.cursor + 1);
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    this.publish({ entries, cursor: entries.length - 1 });
  }

  goBack(): NavigationEntry | null {
    if (this.state.cursor <= 0) return null;
    const cursor = this.state.cursor - 1;
    this.publish({ entries: this.state.entries, cursor });
    return this.state.entries[cursor] ?? null;
  }

  goForward(): NavigationEntry | null {
    if (this.state.cursor >= this.state.entries.length - 1) return null;
    const cursor = this.state.cursor + 1;
    this.publish({ entries: this.state.entries, cursor });
    return this.state.entries[cursor] ?? null;
  }

  clear(): void {
    this.publish({ entries: [], cursor: -1 });
  }

  private publish(partial: Pick<NavigationHistoryState, "entries" | "cursor">): void {
    const entries = partial.entries;
    const cursor = partial.cursor;
    this.state = {
      entries,
      cursor,
      canGoBack: cursor > 0,
      canGoForward: cursor >= 0 && cursor < entries.length - 1,
    };
    for (const listener of this.listeners) listener();
  }
}

export const NavigationHistory = new NavigationHistoryImpl();
