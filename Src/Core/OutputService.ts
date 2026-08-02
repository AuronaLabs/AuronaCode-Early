export type OutputChannelId =
  | "core"
  | "filesystem"
  | "language-server"
  | "debug-adapter"
  | "source-control"
  | "terminal-task"
  | "rust-backend";

export type OutputLevel = "debug" | "info" | "warn" | "error";

export interface OutputEntry {
  id: number;
  timestamp: string;
  level: OutputLevel;
  message: string;
}

export interface OutputChannelSnapshot {
  id: OutputChannelId;
  label: string;
  entries: readonly OutputEntry[];
  bytes: number;
  revision: number;
}

type Listener = () => void;

const MAX_ENTRIES = 5_000;
const MAX_BYTES = 2 * 1024 * 1024;
const SECRET_PATTERN =
  /((?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]\s*)([^\s,;]+)/gi;

const LABELS: Record<OutputChannelId, string> = {
  core: "Aurona Code · Core",
  filesystem: "Aurona Code · File System",
  "language-server": "Language Services",
  "debug-adapter": "Debug Adapters",
  "source-control": "Project · Git",
  "terminal-task": "Project · Tasks",
  "rust-backend": "Aurona Code · Rust Backend",
};

const redact = (message: string) => message.replace(SECRET_PATTERN, "$1[REDACTED]");
const bytesOf = (value: string) => new TextEncoder().encode(value).byteLength;

class OutputServiceImpl {
  private sequence = 0;
  private readonly listeners = new Set<Listener>();
  private readonly channels = new Map<OutputChannelId, OutputChannelSnapshot>(
    (Object.keys(LABELS) as OutputChannelId[]).map((id) => [
      id,
      { id, label: LABELS[id], entries: [], bytes: 0, revision: 0 },
    ]),
  );

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getChannels(): readonly OutputChannelSnapshot[] {
    return [...this.channels.values()];
  }

  getChannel(id: OutputChannelId): OutputChannelSnapshot {
    const channel = this.channels.get(id);
    if (!channel) throw new Error(`Unknown output channel: ${id}`);
    return channel;
  }

  append(id: OutputChannelId, message: string, level: OutputLevel = "info"): void {
    const previous = this.getChannel(id);
    const normalized = redact(message.replace(/\r\n?/g, "\n"));
    const entry: OutputEntry = {
      id: ++this.sequence,
      timestamp: new Date().toISOString(),
      level,
      message: normalized,
    };
    const entries = [...previous.entries, entry];
    let bytes = previous.bytes + bytesOf(normalized);
    while (entries.length > MAX_ENTRIES || bytes > MAX_BYTES) {
      const removed = entries.shift();
      if (!removed) break;
      bytes -= bytesOf(removed.message);
    }
    this.channels.set(id, {
      ...previous,
      entries,
      bytes,
      revision: previous.revision + 1,
    });
    this.emit();
  }

  clear(id: OutputChannelId): void {
    const previous = this.getChannel(id);
    this.channels.set(id, {
      ...previous,
      entries: [],
      bytes: 0,
      revision: previous.revision + 1,
    });
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const OutputService = new OutputServiceImpl();
