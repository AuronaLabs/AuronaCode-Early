import { writeTextFile, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';

class LoggerImpl {
  private logId: string;
  private logBuffer: string[] = [];
  private hasInit = false;

  constructor() {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timeStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    this.logId = `Aurona-Crash-${timeStr}`;
    
    this.logBuffer.push(`=================================================================\n`);
    this.logBuffer.push(`                   AURONA CODE CRASH REPORT                      \n`);
    this.logBuffer.push(`=================================================================\n`);
    this.logBuffer.push(` Session ID : ${this.logId}\n`);
    this.logBuffer.push(` Timestamp  : ${d.toLocaleString()}\n`);
    this.logBuffer.push(` Platform   : ${navigator.userAgent}\n`);
    this.logBuffer.push(`=================================================================\n\n`);
  }

  public getLogId() {
    return this.logId;
  }

  public init() {
    if (this.hasInit) return;
    this.hasInit = true;

    // Hijack console
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;

    console.error = (...args) => {
      this.capture('ERROR', args);
      originalError(...args);
    };
    console.warn = (...args) => {
      this.capture('WARN', args);
      originalWarn(...args);
    };
    console.log = (...args) => {
      this.capture('INFO', args);
      originalLog(...args);
    };
  }

  private capture(level: string, args: any[]) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack}`;
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const logLine = `[${timestamp}] [${level}]\n${message}\n-------------------------------------------------\n`;
    this.logBuffer.push(logLine);
    this.flush();
  }

  private async flush() {
    if (this.logBuffer.length === 0) return;
    try {
      await mkdir('logs', { baseDir: BaseDirectory.AppLocalData, recursive: true });
      const content = this.logBuffer.join('');
      await writeTextFile(`logs/${this.logId}.log`, content, { baseDir: BaseDirectory.AppLocalData });
    } catch (e) {
      // Silently fail to avoid infinite loop
    }
  }
}

export const Logger = new LoggerImpl();
