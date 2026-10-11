import { EventBus } from "../Foundation/EventBus";
import { PtyIPC } from "../Foundation/IPC/PtyCommands";
import type { ShellProfile, TerminalInstance } from "../Foundation/Types/Terminal";

export type { ShellProfile, TerminalInstance };

class TerminalServiceImpl {
  private terminals: TerminalInstance[] = [];
  private activeTerminalId: string | null = null;
  private cachedShells: ShellProfile[] | null = null;
  private nextIndex = 1;
  private nextId = 1;
  private implicitTerminalCreation: Promise<TerminalInstance> | null = null;
  private readiness = new Map<
    string,
    { promise: Promise<void>; resolve: () => void; ready: boolean; failure?: Error }
  >();

  private createReadiness(id: string) {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    this.readiness.set(id, { promise, resolve, ready: false });
  }

  async getAvailableShells(): Promise<ShellProfile[]> {
    if (this.cachedShells) return this.cachedShells;
    try {
      this.cachedShells = await PtyIPC.getAvailableShells();
    } catch {
      this.cachedShells = [];
    }
    return this.cachedShells;
  }

  async createTerminal(shellId?: string, cwd?: string): Promise<TerminalInstance> {
    const shells = await this.getAvailableShells();
    const shell =
      (shellId ? shells.find((s) => s.id === shellId) : null) ??
      shells[0] ??
      ({ id: "default", name: "Shell", path: "", icon: "terminal" } as ShellProfile);

    const id = `terminal-${Date.now()}-${this.nextId++}`;
    const name = `${shell.name} ${this.nextIndex++}`;
    const instance: TerminalInstance = { id, name, shell, cwd };

    this.terminals.push(instance);
    this.createReadiness(id);
    this.setActiveTerminal(id);

    EventBus.emit("terminal:list-changed", [...this.terminals]);
    return instance;
  }

  removeTerminal(id: string): void {
    this.terminals = this.terminals.filter((t) => t.id !== id);
    PtyIPC.close(id).catch(() => {});
    const readiness = this.readiness.get(id);
    if (readiness) {
      readiness.failure = new Error("Terminal was closed before it became ready");
      readiness.resolve();
    }
    this.readiness.delete(id);

    if (this.activeTerminalId === id) {
      const next = this.terminals[this.terminals.length - 1]?.id ?? null;
      this.activeTerminalId = next;
      EventBus.emit("terminal:active-changed", next);
    }
    EventBus.emit("terminal:list-changed", [...this.terminals]);
  }

  renameTerminal(id: string, newName: string): void {
    const terminal = this.terminals.find((t) => t.id === id);
    if (!terminal) return;
    terminal.name = newName;
    EventBus.emit("terminal:list-changed", [...this.terminals]);
  }

  setActiveTerminal(id: string): void {
    this.activeTerminalId = id;
    EventBus.emit("terminal:active-changed", id);
  }

  getTerminals(): TerminalInstance[] {
    return this.terminals;
  }

  getActiveTerminalId(): string | null {
    return this.activeTerminalId;
  }

  async ensureDefaultTerminal(): Promise<TerminalInstance> {
    const existing = this.terminals.find((terminal) => terminal.id === this.activeTerminalId);
    if (existing) return existing;
    if (this.terminals.length > 0) {
      const terminal = this.terminals[this.terminals.length - 1];
      this.setActiveTerminal(terminal.id);
      return terminal;
    }
    if (!this.implicitTerminalCreation) {
      this.implicitTerminalCreation = this.createTerminal().finally(() => {
        this.implicitTerminalCreation = null;
      });
    }
    return this.implicitTerminalCreation;
  }

  markTerminalReady(id: string): void {
    const readiness = this.readiness.get(id);
    if (!readiness) return;
    readiness.ready = true;
    readiness.resolve();
  }

  markTerminalFailed(id: string, error: unknown): void {
    console.warn("Terminal failed before becoming ready", id, error);
    const readiness = this.readiness.get(id);
    if (!readiness) return;
    readiness.failure = error instanceof Error ? error : new Error(String(error));
    readiness.resolve();
  }

  private async waitForTerminalReady(id: string): Promise<void> {
    const readiness = this.readiness.get(id);
    if (!readiness) return;
    if (!readiness.ready && !readiness.failure) {
      await Promise.race([
        readiness.promise,
        new Promise<void>((_, reject) => {
          window.setTimeout(() => reject(new Error("Terminal startup timed out")), 10_000);
        }),
      ]);
    }
    if (readiness.failure) throw readiness.failure;
  }

  async executeCommand(id: string | null, command: string): Promise<void> {
    let targetId = id ?? this.activeTerminalId;
    if (!targetId) {
      const instance = await this.ensureDefaultTerminal();
      targetId = instance.id;
    }
    EventBus.emit("app:toggle-terminal", true);

    await this.waitForTerminalReady(targetId);
    await PtyIPC.write(targetId, `${command}\r\n`);
  }

  async executeCommandAndWait(
    id: string | null,
    command: string,
    signal?: AbortSignal,
  ): Promise<{ exitCode: number; output: string }> {
    let targetId = id ?? this.activeTerminalId;
    if (!targetId) targetId = (await this.ensureDefaultTerminal()).id;
    const terminal = this.terminals.find((item) => item.id === targetId);
    if (!terminal) throw new Error(`Terminal ${targetId} is not available`);
    const commandTargetId = targetId;
    EventBus.emit("app:toggle-terminal", true);
    await this.waitForTerminalReady(targetId);

    const token = `__AURONA_CMD_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    const shellId = terminal.shell.id.toLowerCase();
    const wrapped = ["powershell", "pwsh"].includes(shellId)
      ? `& { ${command}\n$__aurona_exit = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }; Write-Output "${token}:$__aurona_exit" }`
      : `{ ${command}\n; __aurona_exit=$?; printf '\\n${token}:%s\\n' "$__aurona_exit"; }`;

    let output = "";
    let settled = false;
    let timeoutId: number | undefined;
    let removeOutput: (() => void) | undefined;
    let removeExit: (() => void) | undefined;
    let removeAbort: (() => void) | undefined;
    const finish = (
      resolve: (value: { exitCode: number; output: string }) => void,
      reject: (error: Error) => void,
      result?: { exitCode: number; output: string },
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      removeOutput?.();
      removeExit?.();
      removeAbort?.();
      if (result) resolve(result);
      else reject(error ?? new Error("Terminal command failed"));
    };

    return new Promise((resolve, reject) => {
      void (async () => {
        const decode = (data: string) => {
          const raw = atob(data);
          const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
          return new TextDecoder().decode(bytes);
        };
        removeOutput = await PtyIPC.listenOutput((payload) => {
          if (payload.id !== commandTargetId) return;
          output = `${output}${decode(payload.data)}`.slice(-128_000);
          const match = output.match(new RegExp(`${token}:(\\d+)`));
          if (match) {
            const exitCode = Number(match[1]);
            const marker = match.index ?? output.length;
            finish(resolve, reject, { exitCode, output: output.slice(0, marker).trim() });
          }
        });
        removeExit = await PtyIPC.listenExit((payload) => {
          if (payload.id === commandTargetId && !settled) {
            finish(resolve, reject, undefined, new Error(payload.reason));
          }
        });
        const onAbort = () => {
          void PtyIPC.write(commandTargetId, "\u0003").catch(() => undefined);
          finish(resolve, reject, undefined, new Error("Terminal command cancelled"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => signal?.removeEventListener("abort", onAbort);
        timeoutId = window.setTimeout(
          () => finish(resolve, reject, undefined, new Error("Terminal command timed out")),
          120_000,
        );
        if (signal?.aborted) return onAbort();
        try {
          await PtyIPC.write(commandTargetId, `${wrapped}\r\n`);
        } catch (error) {
          finish(
            resolve,
            reject,
            undefined,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      })().catch((error) => {
        finish(
          resolve,
          reject,
          undefined,
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    });
  }

  async clearTerminal(id: string): Promise<void> {
    await PtyIPC.write(id, "\x1b[2J\x1b[H");
  }

  dispose(): void {
    const terminalIds = this.terminals.map((terminal) => terminal.id);
    for (const readiness of this.readiness.values()) {
      readiness.failure = new Error("Terminal service was disposed");
      readiness.resolve();
    }
    this.terminals = [];
    this.activeTerminalId = null;
    this.cachedShells = null;
    this.readiness.clear();
    this.nextIndex = 1;
    this.implicitTerminalCreation = null;
    void Promise.allSettled(terminalIds.map((id) => PtyIPC.close(id)));
  }
}

export const TerminalManager = new TerminalServiceImpl();
