import { BaseDirectory, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

const MAX_QUEUED_LOG_ENTRIES = 1_000;
const LOG_RETRY_DELAY_MS = 1_000;

function serializeError(obj: any, seen = new WeakSet()): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);

  if (obj instanceof Error) {
    const err: any = { name: obj.name, message: obj.message, stack: obj.stack };
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (!["name", "message", "stack"].includes(key)) {
        err[key] = serializeError(obj[key as keyof typeof obj], seen);
      }
    }
    return err;
  }

  const serialized: any = Array.isArray(obj) ? [] : {};
  for (const key of Object.getOwnPropertyNames(obj)) {
    serialized[key] = serializeError(obj[key as keyof typeof obj], seen);
  }
  return serialized;
}

class LoggerImpl {
  private readonly logId: string;
  private readonly logFilePath: string;
  private readonly queue: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private dirEnsured = false;
  private initialized = false;

  constructor() {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    this.logId = `Aurona-Log-${date}_${time}`;
    this.logFilePath = "app.log";

    this.queue.push(`# Aurona Code Log\n# Log: ${this.logId}\n# Started: ${d.toISOString()}\n\n`);
  }

  getLogId(): string {
    return this.logId;
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    window.onerror = (message, source, lineno, colno, error) => {
      this.error(`Uncaught: ${message} (${source}:${lineno}:${colno})`, error);
    };

    window.addEventListener("unhandledrejection", (event) => {
      this.error("Unhandled Promise Rejection", event.reason);
    });

    window.addEventListener("beforeunload", () => {
      if (this.queue.length > 0) {
        void this.flush();
      }
    });

    this.scheduleFlush();
  }

  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.log("error", message, data);
    this.writeErrorFile(message, data);
  }

  private async writeErrorFile(message: string, data?: unknown): Promise<void> {
    const d = new Date();
    const pad = (n: number, width = 2) => n.toString().padStart(width, "0");
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
    const errFileName = `errlogs/Aurona-Error-${ts}.log`;

    let suffix = "";
    if (data !== undefined) {
      try {
        const serialized = serializeError(data);
        suffix = `\n  ${JSON.stringify(serialized, null, 2)}`;
      } catch {
        suffix = `\n  ${String(data)}`;
      }
    }

    const content = `[${d.toISOString()}] [ERROR] ${message}${suffix}\n`;

    try {
      await mkdir("errlogs", {
        baseDir: BaseDirectory.AppLog,
        recursive: true,
      });
      await writeTextFile(errFileName, content, {
        baseDir: BaseDirectory.AppLog,
      });
    } catch {}
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    const ts = new Date().toISOString();
    let suffix = "";
    if (data !== undefined) {
      try {
        const serialized = serializeError(data);
        suffix = `\n  ${JSON.stringify(serialized, null, 2)}`;
      } catch {
        suffix = `\n  ${String(data)}`;
      }
    }
    this.queue.push(`[${ts}] [${level.toUpperCase()}] ${message}${suffix}\n`);
    this.trimQueue();
    this.scheduleFlush();
  }

  private scheduleFlush(delay = 100): void {
    if (this.flushTimer !== null) return;
    // 防抖批量写入，减少 I/O 频率
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.flushInFlight) {
      await this.flushInFlight;
      return;
    }

    if (this.queue.length === 0) return;

    this.flushInFlight = this.flushQueuedLogs();
    try {
      await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
      if (this.queue.length > 0) this.scheduleFlush();
    }
  }

  private async flushQueuedLogs(): Promise<void> {
    const lines = this.queue.splice(0);
    try {
      if (!this.dirEnsured) {
        await mkdir("", {
          baseDir: BaseDirectory.AppLog,
          recursive: true,
        });
        this.dirEnsured = true;
      }
      await writeTextFile(this.logFilePath, lines.join(""), {
        baseDir: BaseDirectory.AppLog,
        append: true,
      });
    } catch {
      this.queue.unshift(...lines);
      this.trimQueue();
      this.scheduleFlush(LOG_RETRY_DELAY_MS);
    }
  }

  private trimQueue(): void {
    if (this.queue.length <= MAX_QUEUED_LOG_ENTRIES) return;

    const dropped = this.queue.length - MAX_QUEUED_LOG_ENTRIES + 1;
    this.queue.splice(0, dropped);
    this.queue.unshift(
      `[${new Date().toISOString()}] [WARN] Dropped ${dropped} buffered log entries after a write failure.\n`,
    );
  }
}

export const Logger = new LoggerImpl();
