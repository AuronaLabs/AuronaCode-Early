export interface Command {
  id: string;
  title: string;
  category?: string;
  execute: (...args: any[]) => void | Promise<void>;
  keybinding?: string;
}

class CommandRegistryImpl {
  private commands = new Map<string, Command>();

  register(command: Command): () => void {
    if (this.commands.has(command.id)) {
      console.warn(`Command ${command.id} is already registered. Overwriting.`);
    }
    this.commands.set(command.id, command);
    return () => this.unregister(command.id);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  execute(id: string, ...args: any[]): void {
    const cmd = this.commands.get(id);
    if (!cmd) {
      console.warn(`Command ${id} not found.`);
      return;
    }
    try {
      cmd.execute(...args);
    } catch (e) {
      console.error(`Error executing command ${id}:`, e);
    }
  }

  getCommands(): Command[] {
    return Array.from(this.commands.values());
  }
}

export const CommandRegistry = new CommandRegistryImpl();

CommandRegistry.register({
  id: "workbench.action.reloadWindow",
  title: "重新加载窗口",
  execute: () => window.location.reload(),
});
