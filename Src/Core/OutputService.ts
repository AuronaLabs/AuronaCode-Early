/** 内置频道 id 保持封闭联合，获得字面量补全与拼写检查 */
export type BuiltinOutputChannelId =
  | "core"
  | "filesystem"
  | "language-server"
  | "debug-adapter"
  | "source-control"
  | "terminal-task"
  | "rust-backend";

/**
 * 扩展动态频道统一挂到 extension: 命名空间（ensureExtensionChannel 归一化），
 * (string & {}) 惯用法让自定义 id 可传入的同时保留内置 id 的自动补全。
 */
export type OutputChannelId = BuiltinOutputChannelId | (string & {});

export const EXTENSION_CHANNEL_PREFIX = "extension:";

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

const LABELS: Record<BuiltinOutputChannelId, string> = {
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
    (Object.keys(LABELS) as BuiltinOutputChannelId[]).map((id) => [
      id,
      { id, label: LABELS[id], entries: [], bytes: 0, revision: 0 },
    ]),
  );

  /**
   * 注册（或复用）动态扩展输出频道，id 自动归一化到 extension: 命名空间，
   * 避免扩展自定义频道与内置频道或彼此之间冲突。
   */
  ensureExtensionChannel(id: string, label?: string): OutputChannelId {
    const normalized = id.startsWith(EXTENSION_CHANNEL_PREFIX)
      ? id
      : `${EXTENSION_CHANNEL_PREFIX}${id}`;
    const channelId = normalized as OutputChannelId;
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, {
        id: channelId,
        label: label || channelId,
        entries: [],
        bytes: 0,
        revision: 0,
      });
      this.emit();
    }
    return channelId;
  }

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
