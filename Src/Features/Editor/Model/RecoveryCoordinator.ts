import { RecoveryStore } from "./RecoveryStore";

const RECOVERY_DEBOUNCE_MS = 2_000;

interface RecoveryDocumentState {
  path: string;
  text: string;
  diskFingerprint: string;
  generation: number;
  persistedGeneration: number;
  timer: ReturnType<typeof window.setTimeout> | null;
}

const documents = new Map<string, RecoveryDocumentState>();
const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite(state: RecoveryDocumentState): Promise<void> {
  const generation = state.generation;
  const text = state.text;
  const diskFingerprint = state.diskFingerprint;
  const previous = writeQueues.get(state.path) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => RecoveryStore.save(state.path, text, diskFingerprint))
    .then(() => {
      const latest = documents.get(state.path);
      if (latest) latest.persistedGeneration = Math.max(latest.persistedGeneration, generation);
    });
  const tracked = current.finally(() => {
    if (writeQueues.get(state.path) === tracked) writeQueues.delete(state.path);
  });
  writeQueues.set(state.path, tracked);
  return current;
}

function schedule(state: RecoveryDocumentState): void {
  if (state.timer !== null) window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => {
    state.timer = null;
    void enqueueWrite(state);
  }, RECOVERY_DEBOUNCE_MS);
}

export const RecoveryCoordinator = {
  update(path: string, text: string, diskFingerprint: string, dirty: boolean): void {
    if (!dirty || !diskFingerprint) {
      this.unregister(path);
      return;
    }

    const current = documents.get(path);
    if (current && current.text === text && current.diskFingerprint === diskFingerprint) return;

    const state: RecoveryDocumentState = current ?? {
      path,
      text,
      diskFingerprint,
      generation: 0,
      persistedGeneration: -1,
      timer: null,
    };
    state.text = text;
    state.diskFingerprint = diskFingerprint;
    state.generation += 1;
    documents.set(path, state);
    schedule(state);
  },

  async flush(path: string): Promise<void> {
    const state = documents.get(path);
    if (!state) {
      await (writeQueues.get(path) ?? Promise.resolve());
      return;
    }
    if (state.timer !== null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.persistedGeneration < state.generation) await enqueueWrite(state);
    await (writeQueues.get(path) ?? Promise.resolve());
  },

  async flushAll(): Promise<void> {
    await Promise.all([...documents.keys()].map((path) => this.flush(path)));
  },

  unregister(path: string): void {
    const state = documents.get(path);
    if (state && state.timer !== null) window.clearTimeout(state.timer);
    documents.delete(path);
  },

  async discard(path: string): Promise<void> {
    this.unregister(path);
    await (writeQueues.get(path) ?? Promise.resolve());
    await RecoveryStore.remove(path);
  },

  resetForTests(): void {
    for (const state of documents.values()) {
      if (state.timer !== null) window.clearTimeout(state.timer);
    }
    documents.clear();
    writeQueues.clear();
  },
};
