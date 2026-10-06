import type { AgentToolMetadata } from "./AgentTypes";

function independentRead(metadata: AgentToolMetadata | undefined): boolean {
  return Boolean(
    metadata?.parallelSafety === "readonly" &&
      metadata.permission === "read" &&
      metadata.checkpointPolicy === "never" &&
      metadata.effects.every((effect) => effect.endsWith(".read")),
  );
}

export async function scheduleAgentTools<T, R>(
  calls: readonly T[],
  metadata: (call: T) => AgentToolMetadata | undefined,
  execute: (call: T) => Promise<R>,
  signal: AbortSignal,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  while (index < calls.length && !signal.aborted) {
    const batch: T[] = [];
    const scopes = new Set<string>();
    while (index < calls.length && batch.length < 4) {
      const next = metadata(calls[index]);
      const conflicts = next?.conflictScopes ?? [];
      if (!independentRead(next) || conflicts.some((scope) => scopes.has(scope))) break;
      batch.push(calls[index++]);
      for (const scope of conflicts) scopes.add(scope);
    }
    // An exclusive call is a barrier: later reads must observe its result.
    if (batch.length === 0) batch.push(calls[index++]);
    // Settle the whole batch before exposing an error or starting a write barrier.
    const settled = await Promise.allSettled(
      batch.map((call) => Promise.resolve().then(() => execute(call))),
    );
    const failed = settled.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    for (const result of settled) {
      if (result.status === "fulfilled") results.push(result.value);
    }
  }
  return results;
}
