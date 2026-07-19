export interface CommandContext {
  activeFilePath: string | null;
  hasActiveEditor: boolean;
  textInputFocused: boolean;
  platform: "windows" | "macos" | "linux";
  bottomPanelOpen: boolean;
}

export type ContextPredicate = (context: CommandContext) => boolean;

export interface Keybinding {
  key: string;
  primary?: boolean;
  shift?: boolean;
  alt?: boolean;
  allowInInput?: boolean;
}

export type CommandPlacement = "file-menu" | "edit-menu" | "run-menu" | "help-menu";

export interface CommandDefinition<Args = undefined> {
  id: string;
  title: string;
  category: string;
  handler: (args: Args, context: CommandContext) => void | Promise<void>;
  canExecute?: ContextPredicate;
  when?: ContextPredicate;
  keybindings?: Keybinding[];
  placements?: CommandPlacement[];
}

export interface CommandExecutionResult {
  ok: boolean;
  error?: Error;
}

const EMPTY_CONTEXT: CommandContext = {
  activeFilePath: null,
  hasActiveEditor: false,
  textInputFocused: false,
  platform: "windows",
  bottomPanelOpen: false,
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select, [role='textbox']");
};

class CommandRegistryImpl {
  private readonly commands = new Map<string, CommandDefinition<unknown>>();
  private contextProvider = () => EMPTY_CONTEXT;

  setContextProvider(provider: () => CommandContext): () => void {
    this.contextProvider = provider;
    return () => {
      if (this.contextProvider === provider) this.contextProvider = () => EMPTY_CONTEXT;
    };
  }

  register<Args>(command: CommandDefinition<Args>): () => void {
    this.commands.set(command.id, command as CommandDefinition<unknown>);
    return () => this.unregister(command.id);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  async execute<Args = undefined>(id: string, args?: Args): Promise<CommandExecutionResult> {
    const command = this.commands.get(id);
    if (!command) return { ok: false, error: new Error(`Command not found: ${id}`) };
    const context = this.contextProvider();
    if (command.when && !command.when(context)) return { ok: false };
    if (command.canExecute && !command.canExecute(context)) return { ok: false };
    try {
      await command.handler(args, context);
      return { ok: true };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return { ok: false, error };
    }
  }

  getCommands(): CommandDefinition<unknown>[] {
    const context = this.contextProvider();
    return [...this.commands.values()]
      .filter((command) => !command.when || command.when(context))
      .sort((left, right) =>
        `${left.category}:${left.title}`.localeCompare(`${right.category}:${right.title}`, "zh-CN"),
      );
  }

  canExecute(command: CommandDefinition<unknown>): boolean {
    const context = this.contextProvider();
    return (
      (!command.when || command.when(context)) &&
      (!command.canExecute || command.canExecute(context))
    );
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const editable = isEditableTarget(event.target);
    for (const command of this.getCommands()) {
      const keybinding = command.keybindings?.find(
        (binding) =>
          binding.key.toLowerCase() === event.key.toLowerCase() &&
          Boolean(binding.primary) === Boolean(event.ctrlKey || event.metaKey) &&
          Boolean(binding.shift) === event.shiftKey &&
          Boolean(binding.alt) === event.altKey &&
          (!editable || binding.allowInInput),
      );
      if (!keybinding) continue;
      void this.execute(command.id).then((result) => {
        if (!result.ok && result.error) console.error(result.error);
      });
      return true;
    }
    return false;
  }
}

export const CommandRegistry = new CommandRegistryImpl();
