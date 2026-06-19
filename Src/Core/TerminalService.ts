import { invoke } from "@tauri-apps/api/core";
import { EventBus } from "./EventBus";

export interface ShellProfile {
  id: string;
  name: string;
  path: string;
  icon: string;
}

export interface TerminalInstance {
  id: string;
  name: string;
  shell: ShellProfile;
}

class TerminalService {
  private terminals: TerminalInstance[] = [];
  private activeTerminalId: string | null = null;
  private shells: ShellProfile[] | null = null;

  public async getAvailableShells(): Promise<ShellProfile[]> {
    if (!this.shells) {
      try {
        this.shells = await invoke<ShellProfile[]>("get_available_shells");
      } catch (error) {
        console.error("Failed to get available shells", error);
        this.shells = [{ id: "powershell", name: "PowerShell", path: "powershell.exe", icon: "powershell" }];
      }
    }
    return this.shells;
  }

  public async createTerminal(shellId?: string): Promise<TerminalInstance> {
    const shells = await this.getAvailableShells();
    const shell = shellId ? shells.find(s => s.id === shellId) : shells[0];
    const actualShell = shell || shells[0];

    const newId = Date.now().toString();
    const name = `${actualShell.name} ${this.terminals.length + 1}`;
    
    const instance: TerminalInstance = {
      id: newId,
      name,
      shell: actualShell
    };

    this.terminals.push(instance);
    this.activeTerminalId = newId;
    
    // Broadcast changes
    EventBus.emit("terminal:list-changed", this.terminals);
    EventBus.emit("terminal:active-changed", newId);
    
    return instance;
  }

  public removeTerminal(id: string) {
    this.terminals = this.terminals.filter(t => t.id !== id);
    if (this.activeTerminalId === id) {
      this.activeTerminalId = this.terminals.length > 0 ? this.terminals[this.terminals.length - 1].id : null;
      EventBus.emit("terminal:active-changed", this.activeTerminalId);
    }
    EventBus.emit("terminal:list-changed", this.terminals);
  }

  public renameTerminal(id: string, newName: string) {
    const term = this.terminals.find(t => t.id === id);
    if (term && newName.trim()) {
      term.name = newName.trim();
      EventBus.emit("terminal:list-changed", this.terminals);
    }
  }

  public setActiveTerminal(id: string) {
    if (this.terminals.some(t => t.id === id)) {
      this.activeTerminalId = id;
      EventBus.emit("terminal:active-changed", id);
    }
  }

  public getTerminals() {
    return this.terminals;
  }

  public getActiveTerminalId() {
    return this.activeTerminalId;
  }

  public async executeCommand(id: string | null, command: string) {
    let targetId = id;
    
    if (!targetId) {
      // Create new or use active
      if (!this.activeTerminalId) {
        await this.createTerminal();
      }
      targetId = this.activeTerminalId;
    }

    if (!targetId) return;

    // Make sure panel is open
    EventBus.emit("app:toggle-terminal", true);
    
    // Slight delay to ensure PTY has started if it's new
    setTimeout(async () => {
      try {
        // Use \r\n to handle Windows PowerShell correctly
        await invoke("write_pty", { id: targetId, data: command + "\r\n" });
      } catch (e) {
        console.error("Failed to execute command", e);
      }
    }, 100);
  }

  public async clearTerminal(id: string) {
    try {
      await invoke("write_pty", { id, data: "clear\r\n" });
    } catch (e) {
      console.error("Failed to clear terminal", e);
    }
  }
}

export const TerminalManager = new TerminalService();
