import { BaseDirectory, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";

export type LogLevel = "debug" | "info" | "warn" | "error";


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
  private dirEnsured = false;
  private initialized = false;

  constructor() {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    this.logId = `Aurona-Log-${date}_${time}`;
    this.logFilePath = `logs/${this.logId}.log`;

    
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
        baseDir: BaseDirectory.AppLocalData,
        recursive: true,
      });
      await writeTextFile(errFileName, content, {
        baseDir: BaseDirectory.AppLocalData,
      });
    } catch {
      
    }
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
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    // 防抖批量写入，减少 I/O 频率
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 100);
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const lines = this.queue.splice(0);
    try {
      if (!this.dirEnsured) {
        await mkdir("logs", {
          baseDir: BaseDirectory.AppLocalData,
          recursive: true,
        });
        this.dirEnsured = true;
      }
      await writeTextFile(this.logFilePath, lines.join(""), {
        baseDir: BaseDirectory.AppLocalData,
        append: true,
      });
    } catch {
      
    }
  }
}

export const Logger = new LoggerImpl();
