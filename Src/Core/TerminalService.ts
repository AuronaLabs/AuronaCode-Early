import { EventBus } from "../Foundation/EventBus";
import { PtyIPC } from "../Foundation/IPC/PtyCommands";
import { DisposableScope } from "../Foundation/Lifecycle/DisposableScope";
import type { ShellProfile, TerminalInstance } from "../Foundation/Types/Terminal";
import { wrapTerminalCommand } from "./TerminalCommand";

export type { ShellProfile, TerminalInstance };

class TerminalServiceImpl {
  private terminals: TerminalInstance[] = [];
  private activeTerminalId: string | null = null;
  private cachedShells: ShellProfile[] | null = null;
  private shellDiscovery: Promise<ShellProfile[]> | null = null;
  private generation = 0;
  private commands = new Map<string, Set<(error: Error) => void>>();
  private nextIndex = 1;
  private nextId = 1;
  private implicitTerminalCreation: Promise<TerminalInstance> | null = null;
  private readiness = new Map<
    string,
    {
      promise: Promise<void>;
      resolve: () => void;
      ready: boolean;
      failure?: Error;
      sessionId?: string;
    }
  >();

  private createReadiness(id: string, sessionId?: string) {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    this.readiness.set(id, { promise, resolve, ready: false, sessionId });
  }

  async getAvailableShells(): Promise<ShellProfile[]> {
    if (this.cachedShells) return this.cachedShells;
    if (this.shellDiscovery) return this.shellDiscovery;
    const generation = this.generation;
    const request = PtyIPC.getAvailableShells().then(
      (shells) => {
        if (generation === this.generation) this.cachedShells = shells;
        return shells;
      },
      () => [],
    );
    this.shellDiscovery = request;
    try {
      return await request;
    } finally {
      if (this.shellDiscovery === request) this.shellDiscovery = null;
    }
  }

  async createTerminal(shellId?: string, cwd?: string): Promise<TerminalInstance> {
    const generation = this.generation;
    const shells = await this.getAvailableShells();
    if (generation !== this.generation) throw new Error("Terminal service was disposed");
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
    this.cancelCommands(id, new Error("Terminal was closed"));
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
    if (!this.terminals.some((terminal) => terminal.id === id)) return;
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
      const request = this.createTerminal().finally(() => {
        if (this.implicitTerminalCreation === request) this.implicitTerminalCreation = null;
      });
      this.implicitTerminalCreation = request;
    }
    return this.implicitTerminalCreation;
  }

  beginTerminalSession(id: string, sessionId: string): void {
    const readiness = this.readiness.get(id);
    if (!readiness || readiness.sessionId === sessionId) return;
    if (!readiness.sessionId) {
      readiness.sessionId = sessionId;
      return;
    }
    this.endTerminalSession(id, readiness.sessionId);
    this.createReadiness(id, sessionId);
  }

  endTerminalSession(id: string, sessionId: string): void {
    const readiness = this.readiness.get(id);
    if (!readiness || readiness.sessionId !== sessionId) return;
    readiness.ready = false;
    readiness.failure = new Error("Terminal session was closed or replaced");
    readiness.resolve();
    this.cancelCommands(id, readiness.failure);
  }

  markTerminalReady(id: string, sessionId?: string): void {
    const readiness = this.readiness.get(id);
    if (!readiness || (sessionId && readiness.sessionId !== sessionId)) return;
    if (readiness.failure) return;
    readiness.ready = true;
    readiness.resolve();
  }

  markTerminalFailed(id: string, error: unknown, sessionId?: string): void {
    const readiness = this.readiness.get(id);
    if (!readiness || (sessionId && readiness.sessionId !== sessionId)) return;
    console.warn("Terminal failed before becoming ready", id, error);
    readiness.ready = false;
    readiness.failure = error instanceof Error ? error : new Error(String(error));
    readiness.resolve();
    this.cancelCommands(id, readiness.failure);
  }

  private async waitForTerminalReady(id: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("Terminal command cancelled");
    const readiness = this.readiness.get(id);
    if (!readiness) throw new Error(`Terminal ${id} is not available`);
    if (!readiness.ready && !readiness.failure) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        await Promise.race([
          readiness.promise,
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("Terminal startup timed out")), 10_000);
            onAbort = () => reject(new Error("Terminal command cancelled"));
            signal?.addEventListener("abort", onAbort, { once: true });
          }),
        ]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (onAbort) signal?.removeEventListener("abort", onAbort);
      }
    }
    if (readiness.failure) throw readiness.failure;
    if (signal?.aborted) throw new Error("Terminal command cancelled");
  }

  async executeCommand(id: string | null, command: string): Promise<void> {
    let targetId = id ?? this.activeTerminalId;
    if (!targetId) {
      const instance = await this.ensureDefaultTerminal();
      targetId = instance.id;
    }
    EventBus.emit("app:toggle-terminal", true);

    const session = this.readiness.get(targetId);
    await this.waitForTerminalReady(targetId);
    if (this.readiness.get(targetId) !== session || session?.failure)
      throw new Error("Terminal session was closed or replaced");
    await PtyIPC.write(targetId, `${command}\r\n`);
  }

  async executeCommandAndWait(
    id: string | null,
    command: string,
    signal?: AbortSignal,
  ): Promise<{ exitCode: number; output: string }> {
    if (signal?.aborted) throw new Error("Terminal command cancelled");
    let targetId = id ?? this.activeTerminalId;
    if (!targetId) targetId = (await this.ensureDefaultTerminal()).id;
    const terminal = this.terminals.find((item) => item.id === targetId);
    if (!terminal) throw new Error(`Terminal ${targetId} is not available`);
    const commandTargetId = targetId;
    EventBus.emit("app:toggle-terminal", true);
    const session = this.readiness.get(targetId);
    await this.waitForTerminalReady(targetId, signal);
    if (this.readiness.get(targetId) !== session || session?.failure)
      throw new Error("Terminal session was closed or replaced");
    const sessionId = session?.sessionId;

    const token = `__AURONA_CMD_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    const wrapped = wrapTerminalCommand(terminal.shell.id, command, token);

    let output = "";
    const scope = new DisposableScope();
    const decoder = new TextDecoder();
    return new Promise((resolve, reject) => {
      const finish = (result?: { exitCode: number; output: string }, error?: unknown) => {
        if (scope.isDisposed) return;
        try {
          scope.dispose();
        } catch (cleanupError) {
          console.warn("Unable to release terminal command listeners", cleanupError);
        }
        if (result) resolve(result);
        else reject(error instanceof Error ? error : new Error(String(error)));
      };
      const cancel = (error: Error) => finish(undefined, error);
      const commands = this.commands.get(commandTargetId) ?? new Set();
      commands.add(cancel);
      this.commands.set(commandTargetId, commands);
      scope.add(() => {
        commands.delete(cancel);
        if (commands.size === 0 && this.commands.get(commandTargetId) === commands)
          this.commands.delete(commandTargetId);
      });
      let dispatched = false;
      const onAbort = () => {
        if (dispatched) void PtyIPC.write(commandTargetId, "\u0003").catch(() => undefined);
        finish(undefined, new Error("Terminal command cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      scope.add(() => signal?.removeEventListener("abort", onAbort));
      const timeoutId = setTimeout(
        () => finish(undefined, new Error("Terminal command timed out")),
        120_000,
      );
      scope.add(() => clearTimeout(timeoutId));
      if (signal?.aborted) return onAbort();
      void (async () => {
        const decode = (data: string) => {
          const raw = atob(data);
          const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
          return decoder.decode(bytes, { stream: true });
        };
        scope.add(
          await PtyIPC.listenOutput((payload) => {
            if (scope.isDisposed) return;
            if (payload.id !== commandTargetId || (sessionId && payload.session_id !== sessionId))
              return;
            output = `${output}${decode(payload.data)}`.slice(-128_000);
            const match = output.match(new RegExp(`(?:^|\\r?\\n)${token}:(-?\\d+)\\r?\\n`));
            if (match) {
              const exitCode = Number(match[1]);
              const marker = match.index ?? output.length;
              finish({ exitCode, output: output.slice(0, marker).trim() });
            }
          }),
        );
        if (scope.isDisposed) return;
        scope.add(
          await PtyIPC.listenExit((payload) => {
            if (
              payload.id === commandTargetId &&
              (!sessionId || payload.session_id === sessionId)
            ) {
              finish(undefined, new Error(payload.reason));
            }
          }),
        );
        if (scope.isDisposed) return;
        dispatched = true;
        await PtyIPC.write(commandTargetId, `${wrapped}\r\n`);
      })().catch((error) => finish(undefined, error));
    });
  }

  private cancelCommands(id: string, error: Error): void {
    for (const cancel of Array.from(this.commands.get(id) ?? [])) cancel(error);
  }

  async clearTerminal(id: string): Promise<void> {
    await PtyIPC.write(id, "\x1b[2J\x1b[H");
  }

  dispose(): void {
    this.generation++;
    for (const id of this.commands.keys())
      this.cancelCommands(id, new Error("Terminal service was disposed"));
    const terminalIds = this.terminals.map((terminal) => terminal.id);
    for (const readiness of this.readiness.values()) {
      readiness.failure = new Error("Terminal service was disposed");
      readiness.resolve();
    }
    this.terminals = [];
    this.activeTerminalId = null;
    this.cachedShells = null;
    this.shellDiscovery = null;
    this.readiness.clear();
    this.nextIndex = 1;
    this.implicitTerminalCreation = null;
    void Promise.allSettled(terminalIds.map((id) => PtyIPC.close(id)));
  }
}

export const TerminalManager = new TerminalServiceImpl();
