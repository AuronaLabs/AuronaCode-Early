import { type I18nKey, LocaleService } from "../Foundation/I18n";

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
  /** 可选国际化标题；提供后 Fliuno 等展示层优先使用翻译，缺省回退到 title。 */
  titleKey?: I18nKey;
  /** 可选国际化分类；提供后展示层优先使用翻译，缺省回退到 category。 */
  categoryKey?: I18nKey;
  source?: "core" | "user";
  handler: (args: Args, context: CommandContext) => void | Promise<void>;
  canExecute?: ContextPredicate;
  disabledReason?: (context: CommandContext) => string | undefined;
  when?: ContextPredicate;
  keybindings?: Keybinding[];
  placements?: CommandPlacement[];
}

export function getCommandTitle(command: CommandDefinition<unknown>): string {
  return command.titleKey ? LocaleService.translate(command.titleKey) : command.title;
}

export function getCommandCategory(command: CommandDefinition<unknown>): string {
  return command.categoryKey ? LocaleService.translate(command.categoryKey) : command.category;
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
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private contextProvider = () => EMPTY_CONTEXT;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  private emitChange(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  setContextProvider(provider: () => CommandContext): () => void {
    this.contextProvider = provider;
    return () => {
      if (this.contextProvider === provider) this.contextProvider = () => EMPTY_CONTEXT;
    };
  }

  register<Args>(command: CommandDefinition<Args>): () => void {
    this.commands.set(command.id, command as CommandDefinition<unknown>);
    this.emitChange();
    return () => this.unregister(command.id);
  }

  unregister(id: string): void {
    if (this.commands.delete(id)) this.emitChange();
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

  getDisabledReason(command: CommandDefinition<unknown>): string | undefined {
    const context = this.contextProvider();
    if (command.when && !command.when(context)) return "当前上下文不适用";
    return (
      command.disabledReason?.(context) ??
      (command.canExecute && !command.canExecute(context) ? "当前不可用" : undefined)
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

const globalStore = globalThis as unknown as { __auronaCommandRegistry?: CommandRegistryImpl };

if (!globalStore.__auronaCommandRegistry) {
  globalStore.__auronaCommandRegistry = new CommandRegistryImpl();
}

export const CommandRegistry = globalStore.__auronaCommandRegistry;
