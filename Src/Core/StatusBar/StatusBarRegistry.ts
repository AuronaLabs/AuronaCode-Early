/**
 * Aurona Code 全局状态栏注册表
 * 提供面向对象的响应式状态栏条目生命周期管理，支持核心模块、LSP、Git 与扩展插件动态注册
 */

export type StatusBarAlignment = "left" | "right";

export interface StatusBarItemOptions {
  id: string;
  alignment?: StatusBarAlignment;
  priority?: number;
  text: string;
  tooltip?: string;
  icon?: string;
  command?: string;
  onClick?: () => void | Promise<void>;
  className?: string;
  visible?: boolean;
}

export class StatusBarItemHandle {
  private _text: string;
  private _tooltip?: string;
  private _icon?: string;
  private _command?: string;
  private _onClick?: () => void | Promise<void>;
  private _className?: string;
  private _visible: boolean;
  private _priority: number;

  constructor(
    public readonly id: string,
    public readonly alignment: StatusBarAlignment,
    options: StatusBarItemOptions,
    private readonly onChange: () => void,
    private readonly onDispose: (id: string) => void,
  ) {
    this._text = options.text;
    this._tooltip = options.tooltip;
    this._icon = options.icon;
    this._command = options.command;
    this._onClick = options.onClick;
    this._className = options.className;
    this._visible = options.visible ?? true;
    this._priority = options.priority ?? 0;
  }

  get text(): string {
    return this._text;
  }

  set text(value: string) {
    if (this._text !== value) {
      this._text = value;
      this.onChange();
    }
  }

  get tooltip(): string | undefined {
    return this._tooltip;
  }

  set tooltip(value: string | undefined) {
    if (this._tooltip !== value) {
      this._tooltip = value;
      this.onChange();
    }
  }

  get icon(): string | undefined {
    return this._icon;
  }

  set icon(value: string | undefined) {
    if (this._icon !== value) {
      this._icon = value;
      this.onChange();
    }
  }

  get command(): string | undefined {
    return this._command;
  }

  set command(value: string | undefined) {
    if (this._command !== value) {
      this._command = value;
      this.onChange();
    }
  }

  get onClick(): (() => void | Promise<void>) | undefined {
    return this._onClick;
  }

  set onClick(value: (() => void | Promise<void>) | undefined) {
    this._onClick = value;
    this.onChange();
  }

  get className(): string | undefined {
    return this._className;
  }

  set className(value: string | undefined) {
    if (this._className !== value) {
      this._className = value;
      this.onChange();
    }
  }

  get visible(): boolean {
    return this._visible;
  }

  set visible(value: boolean) {
    if (this._visible !== value) {
      this._visible = value;
      this.onChange();
    }
  }

  get priority(): number {
    return this._priority;
  }

  set priority(value: number) {
    if (this._priority !== value) {
      this._priority = value;
      this.onChange();
    }
  }

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  dispose(): void {
    this.onDispose(this.id);
  }
}

class StatusBarRegistryImpl {
  private readonly items = new Map<string, StatusBarItemHandle>();
  private readonly listeners = new Set<() => void>();

  /**
   * 注册或创建状态栏条目
   */
  createItem(options: StatusBarItemOptions): StatusBarItemHandle {
    const alignment = options.alignment ?? "right";
    const handle = new StatusBarItemHandle(
      options.id,
      alignment,
      options,
      () => this.notify(),
      (id) => this.removeItem(id),
    );
    this.items.set(options.id, handle);
    this.notify();
    return handle;
  }

  /**
   * 获取指定 ID 的状态栏条目
   */
  getItem(id: string): StatusBarItemHandle | undefined {
    return this.items.get(id);
  }

  /**
   * 移除指定 ID 的状态栏条目
   */
  removeItem(id: string): void {
    if (this.items.delete(id)) {
      this.notify();
    }
  }

  /**
   * 获取左侧对齐的所有可见条目（按优先级降序排序）
   */
  getLeftItems(): StatusBarItemHandle[] {
    return Array.from(this.items.values())
      .filter((item) => item.alignment === "left" && item.visible)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取右侧对齐的所有可见条目（按优先级降序排序）
   */
  getRightItems(): StatusBarItemHandle[] {
    return Array.from(this.items.values())
      .filter((item) => item.alignment === "right" && item.visible)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * 订阅状态栏变动（配合 useSyncExternalStore 使用）
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * 获取当前状态快照版本
   */
  getSnapshot = (): number => {
    return this.items.size;
  };

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error("[StatusBarRegistry] 监听器执行异常:", error);
      }
    }
  }
}

export const StatusBarRegistry = new StatusBarRegistryImpl();
