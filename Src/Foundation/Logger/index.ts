import { BaseDirectory, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

// A robust serializer to deeply extract non-enumerable properties from Errors
function serializeError(obj: any, seen = new WeakSet()): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);

  if (obj instanceof Error) {
    const err: any = { name: obj.name, message: obj.message, stack: obj.stack };
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (!['name', 'message', 'stack'].includes(key)) {
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

  constructor() {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    this.logId = `Aurona-Session-${date}_${time}`;
    this.logFilePath = `logs/${this.logId}.log`;

    // 立即将文件头写入队列（等待 init() 后 flush）
    this.queue.push(
      `# Aurona Code Log\n# Session: ${this.logId}\n# Started: ${d.toISOString()}\n\n`
    );
  }

  getLogId(): string {
    return this.logId;
  }

  /**
   * 初始化日志系统。
   * 使用全局错误钩子，替代危险的 monkey-patch console.error。
   */
  init(): void {
    window.onerror = (message, source, lineno, colno, error) => {
      this.error(
        `Uncaught: ${message} (${source}:${lineno}:${colno})`,
        error
      );
    };

    window.addEventListener("unhandledrejection", (event) => {
      this.error("Unhandled Promise Rejection", event.reason);
    });

    window.addEventListener("beforeunload", () => {
      // 尝试在退出前最后刷入一次日志
      if (this.queue.length > 0) {
        void this.flush();
      }
    });

    // 触发第一次 flush，写入会话头部
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
      // 日志写入失败不能影响主程序
    }
  }
}

export const Logger = new LoggerImpl();
