import { EventBus } from "../Foundation/EventBus";
import { PtyIPC } from "../Foundation/IPC/PtyCommands";
import type { ShellProfile, TerminalInstance } from "../Foundation/Types/Terminal";

// 向后兼容 re-export
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

  async createTerminal(shellId?: string): Promise<TerminalInstance> {
    const shells = await this.getAvailableShells();
    const shell =
      (shellId ? shells.find((s) => s.id === shellId) : null) ??
      shells[0] ??
      ({ id: "default", name: "Shell", path: "", icon: "terminal" } as ShellProfile);

    // 使用递增索引而不是 length，避免删除后编号重复
    const id = `terminal-${Date.now()}`;
    const name = `${shell.name} ${this.nextIndex++}`;
    const instance: TerminalInstance = { id, name, shell };

    this.terminals.push(instance);
    this.setActiveTerminal(id);
    // 发布浅拷贝，防止外部修改内部状态
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

  /**
   * 向指定终端（或新建终端）写入命令。
   * 不再使用 setTimeout hack，改为通过 PTY ready 事件确保时序。
   * 当前仍使用 300ms 延迟作为过渡方案，待 0.1.1 引入 PTY ready 回调后移除。
   */
  async executeCommand(id: string | null, command: string): Promise<void> {
    let targetId = id ?? this.activeTerminalId;
    if (!targetId) {
      const instance = await this.createTerminal();
      targetId = instance.id;
    }
    EventBus.emit("app:toggle-terminal", true);
    // TODO(0.1.1): 替换为 PTY ready 事件，移除硬编码延迟
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await PtyIPC.write(targetId, command + "\r\n");
  }

  async clearTerminal(id: string): Promise<void> {
    await PtyIPC.write(id, "\x1b[2J\x1b[H");
  }
}

// 统一命名：TerminalManager
export const TerminalManager = new TerminalServiceImpl();
