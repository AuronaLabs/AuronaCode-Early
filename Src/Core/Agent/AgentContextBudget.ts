const MAX_CONTEXT_TOKENS = 32_768;
const SUMMARY_TOKENS = 512;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// UTF-8 bytes are a conservative upper bound for byte-based model tokenizers.
export function contextTokenUpperBound(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "null").byteLength;
}

export function boundAgentContext(
  input: readonly unknown[],
  budget = MAX_CONTEXT_TOKENS,
): unknown[] {
  const units: Array<{ indices: number[]; cost: number; protected: boolean }> = [];
  const consumed = new Set<number>();
  const outputs = new Map<string, { indices: number[]; next: number }>();
  for (const [index, item] of input.entries()) {
    const value = record(item);
    if (value.type !== "function_call_output" || typeof value.call_id !== "string") continue;
    const bucket = outputs.get(value.call_id) ?? { indices: [], next: 0 };
    bucket.indices.push(index);
    outputs.set(value.call_id, bucket);
  }
  let orphaned = 0;
  for (const [index, item] of input.entries()) {
    if (consumed.has(index)) continue;
    const value = record(item);
    if (value.type === "function_call") {
      const bucket = typeof value.call_id === "string" ? outputs.get(value.call_id) : undefined;
      while (
        bucket &&
        bucket.next < bucket.indices.length &&
        bucket.indices[bucket.next] <= index
      ) {
        bucket.next++;
      }
      const resultIndex = bucket?.indices[bucket.next++] ?? -1;
      if (resultIndex < 0) {
        orphaned++;
        continue;
      }
      consumed.add(resultIndex);
      units.push({
        indices: [index, resultIndex],
        cost: contextTokenUpperBound(item) + contextTokenUpperBound(input[resultIndex]),
        protected: false,
      });
    } else if (value.type === "function_call_output") {
      orphaned++;
    } else {
      units.push({
        indices: [index],
        cost: contextTokenUpperBound(item),
        protected: value.role === "user" || value.role === "developer" || value.role === "system",
      });
    }
  }
  const protectedCost = units
    .filter((unit) => unit.protected)
    .reduce((sum, unit) => sum + unit.cost, 0);
  if (protectedCost > budget - SUMMARY_TOKENS) {
    throw new Error(
      "[agent.context_limit] User instructions exceed the context budget; create an explicit summary before continuing",
    );
  }
  const selected = new Set<number>();
  let remaining = budget - protectedCost - SUMMARY_TOKENS;
  let omitted = orphaned;
  for (const unit of [...units].reverse()) {
    if (unit.protected || unit.cost <= remaining) {
      if (!unit.protected) remaining -= unit.cost;
      for (const index of unit.indices) selected.add(index);
    } else {
      omitted += unit.indices.length;
    }
  }
  const retained = input.filter((_, index) => selected.has(index));
  if (omitted > 0) {
    retained.unshift({
      role: "developer",
      content: [
        {
          type: "input_text",
          text: `Context summary: ${omitted} older assistant/tool records were omitted to fit the token budget. All supplied user instructions remain unchanged. Tool calls and results are retained as pairs. Omitted tool output is unavailable; read the current workspace before relying on earlier results.`,
        },
      ],
    });
  }
  return retained;
}
