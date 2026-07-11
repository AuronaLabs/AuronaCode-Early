import { EventBus } from "../Foundation/EventBus";
import { PtyIPC } from "../Foundation/IPC/PtyCommands";
import type { ShellProfile, TerminalInstance } from "../Foundation/Types/Terminal";

export type { ShellProfile, TerminalInstance };

class TerminalServiceImpl {
  private terminals: TerminalInstance[] = [];
  private activeTerminalId: string | null = null;
  private cachedShells: ShellProfile[] | null = null;
  private nextIndex = 1;

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

    const id = `terminal-${Date.now()}`;
    const name = `${shell.name} ${this.nextIndex++}`;
    const instance: TerminalInstance = { id, name, shell, cwd };

    this.terminals.push(instance);
    this.setActiveTerminal(id);

    EventBus.emit("terminal:list-changed", [...this.terminals]);
    return instance;
  }

  removeTerminal(id: string): void {
    this.terminals = this.terminals.filter((t) => t.id !== id);
    PtyIPC.close(id).catch(() => {});

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

  async executeCommand(id: string | null, command: string): Promise<void> {
    let targetId = id ?? this.activeTerminalId;
    if (!targetId) {
      const instance = await this.createTerminal();
      targetId = instance.id;
    }
    EventBus.emit("app:toggle-terminal", true);

    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await PtyIPC.write(targetId, `${command}\r\n`);
  }

  async clearTerminal(id: string): Promise<void> {
    await PtyIPC.write(id, "\x1b[2J\x1b[H");
  }
}

export const TerminalManager = new TerminalServiceImpl();
