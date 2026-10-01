export interface AgentMemoryEntry {
  id: string;
  text: string;
  scope?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface MemoryQueryOptions {
  scope?: string;
  limit?: number;
}

export interface MemoryProvider {
  query(query: string, options?: MemoryQueryOptions): Promise<AgentMemoryEntry[]>;
  store(
    entry: Omit<AgentMemoryEntry, "id" | "createdAt"> & {
      id?: string;
      createdAt?: number;
    },
  ): Promise<void>;
}

function createMemoryId(): string {
  try {
    return `memory-${crypto.randomUUID()}`;
  } catch {
    return `memory-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** In-memory provider used until persistent project memory is introduced. */
export class InMemoryMemoryProvider implements MemoryProvider {
  private readonly entries: AgentMemoryEntry[] = [];

  async query(query: string, options: MemoryQueryOptions = {}): Promise<AgentMemoryEntry[]> {
    const needle = query.trim().toLocaleLowerCase();
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    return this.entries
      .filter((entry) => !options.scope || entry.scope === options.scope)
      .filter((entry) => !needle || entry.text.toLocaleLowerCase().includes(needle))
      .slice(0, limit)
      .map((entry) => ({ ...entry, metadata: entry.metadata ? { ...entry.metadata } : undefined }));
  }

  async store(
    entry: Omit<AgentMemoryEntry, "id" | "createdAt"> & {
      id?: string;
      createdAt?: number;
    },
  ): Promise<void> {
    const next: AgentMemoryEntry = {
      ...entry,
      id: entry.id || createMemoryId(),
      createdAt: entry.createdAt ?? Date.now(),
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    };
    const index = this.entries.findIndex((item) => item.id === next.id);
    if (index >= 0) this.entries[index] = next;
    else this.entries.unshift(next);
  }
}

export const MemoryService: MemoryProvider = new InMemoryMemoryProvider();
