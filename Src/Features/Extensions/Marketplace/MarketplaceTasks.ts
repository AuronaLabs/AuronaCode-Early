export interface MarketplaceTask {
  taskId: string;
  resourceId: string;
  state: "queued" | "running";
  cancellable: boolean;
}

interface QueuedTask extends MarketplaceTask {
  controller: AbortController;
  execute: (signal: AbortSignal) => Promise<unknown>;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
}

export class MarketplaceTasks {
  private readonly queue: QueuedTask[] = [];
  private readonly running = new Map<string, QueuedTask>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly MarketplaceTask[] = [];
  onIdle: (() => void) | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly MarketplaceTask[] => this.snapshot;

  run<T>(
    resourceId: string,
    execute: (signal: AbortSignal) => Promise<T>,
    cancellable = false,
  ): Promise<T> {
    if (this.queue.length + this.running.size >= 64) {
      return Promise.reject(new Error("[resource.limit] Marketplace task queue is full"));
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        taskId: crypto.randomUUID(),
        resourceId,
        state: "queued",
        cancellable,
        controller: new AbortController(),
        execute,
        resolve: (result) => resolve(result as T),
        reject,
      });
      this.pump();
    });
  }

  cancel(taskId: string): void {
    const index = this.queue.findIndex((task) => task.taskId === taskId);
    if (index >= 0) {
      const [task] = this.queue.splice(index, 1);
      task.controller.abort();
      task.reject(new DOMException("Cancelled", "AbortError"));
      this.publish();
      return;
    }
    const running = this.running.get(taskId);
    if (running?.cancellable) running.controller.abort();
  }

  private publish(): void {
    this.snapshot = [...this.running.values(), ...this.queue].map(
      ({ taskId, resourceId, state, cancellable }) => ({ taskId, resourceId, state, cancellable }),
    );
    for (const listener of this.listeners) listener();
  }

  private pump(): void {
    while (this.running.size < 2) {
      const busy = new Set([...this.running.values()].map((task) => task.resourceId));
      const index = this.queue.findIndex((task) => !busy.has(task.resourceId));
      if (index < 0) break;
      const [task] = this.queue.splice(index, 1);
      task.state = "running";
      this.running.set(task.taskId, task);
      void Promise.resolve()
        .then(() => {
          task.controller.signal.throwIfAborted();
          return task.execute(task.controller.signal);
        })
        .then(task.resolve, task.reject)
        .finally(() => {
          this.running.delete(task.taskId);
          this.pump();
          if (this.running.size === 0 && this.queue.length === 0) this.onIdle?.();
        });
    }
    this.publish();
  }
}
