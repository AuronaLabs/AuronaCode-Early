import { AgentStorageIPC, type AgentStorageSlot } from "../../Foundation/IPC/AgentStorageCommands";

export class SecureAgentStore {
  private chain: Promise<void> = Promise.resolve();
  private initialized = false;
  private error: unknown;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private draining: Promise<void> | null = null;
  constructor(private readonly slot: AgentStorageSlot) {}

  async load(
    legacyKeys: readonly string[],
    valid: (value: string) => boolean,
  ): Promise<string | null> {
    const stored = await AgentStorageIPC.read(this.slot);
    if (stored !== null && stored !== undefined && !valid(stored)) {
      throw new Error("[agent.corrupt] Stored Agent data is malformed; original data is preserved");
    }
    let content = stored ?? null;
    if (content === null) {
      for (const key of legacyKeys) {
        const legacy = localStorage.getItem(key);
        if (!legacy) continue;
        if (!valid(legacy))
          throw new Error(
            "[agent.migration] Legacy Agent data is malformed; original data is preserved",
          );
        content = legacy;
        break;
      }
      if (content !== null) await AgentStorageIPC.write(this.slot, content);
    }
    if (content !== null) {
      const verified = await AgentStorageIPC.read(this.slot);
      if (verified !== content)
        throw new Error("[agent.migration] Backend verification failed; legacy data is preserved");
      for (const key of legacyKeys) {
        const legacy = localStorage.getItem(key);
        // A different staging record may contain edits absent from the primary record.
        if (legacy === content) localStorage.removeItem(key);
      }
    }
    this.initialized = true;
    return content;
  }

  async write(content: string): Promise<void> {
    if (!this.initialized)
      throw new Error("[agent.storage] Agent storage has not been initialized");
    const pending = this.chain
      .catch(() => undefined)
      .then(() => AgentStorageIPC.write(this.slot, content));
    this.chain = pending;
    try {
      await pending;
      this.error = undefined;
    } catch (error) {
      this.error = error;
      throw error;
    }
  }

  schedule(content: string): void {
    if (!this.initialized) return;
    this.pending = content;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain().catch(() => undefined);
    }, 100);
  }

  private drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      while (this.pending !== null) {
        const content = this.pending;
        this.pending = null;
        await this.write(content);
      }
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.drain();
    await this.chain;
    if (this.error) throw this.error;
  }
}
