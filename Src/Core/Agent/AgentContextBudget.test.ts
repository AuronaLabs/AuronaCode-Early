import { boundAgentContext, contextTokenUpperBound } from "./AgentContextBudget";

describe("Agent context budget", () => {
  it("pairs each repeated call ID with a distinct later result", () => {
    const input = [
      { type: "function_call_output", call_id: "same", output: "orphan" },
      { type: "function_call", call_id: "same" },
      { type: "function_call", call_id: "same" },
      { type: "function_call_output", call_id: "same", output: "first" },
      { type: "function_call_output", call_id: "same", output: "second" },
    ];
    expect(boundAgentContext(input).slice(1)).toEqual(input.slice(1));
  });

  it("preserves instructions and omits a call and its large result together", () => {
    const user = { role: "user", content: "never remove my drafts" };
    const input = [
      user,
      { type: "function_call", call_id: "old", name: "read" },
      { type: "function_call_output", call_id: "old", output: "x".repeat(4000) },
      { role: "assistant", content: "latest" },
    ];
    const bounded = boundAgentContext(input, 1024);
    expect(bounded).toContain(user);
    expect(bounded).toContain(input[3]);
    expect(bounded).not.toContain(input[1]);
    expect(bounded).not.toContain(input[2]);
    expect(JSON.stringify(bounded)).toContain("Context summary");
  });
  it("retains complete pairs in original order and eliminates orphans", () => {
    const input = [
      { type: "function_call", call_id: "a" },
      { role: "assistant", content: "hello" },
      { type: "function_call_output", call_id: "a", output: "ok" },
      { type: "function_call_output", call_id: "missing", output: "unknown" },
    ];
    expect(boundAgentContext(input).slice(1)).toEqual(input.slice(0, 3));
  });
  it("counts multibyte input conservatively and rejects instructions it cannot preserve", () => {
    expect(contextTokenUpperBound("中文")).toBeGreaterThan(JSON.stringify("中文").length);
    expect(() => boundAgentContext([{ role: "user", content: "x".repeat(2000) }], 1024)).toThrow(
      "context_limit",
    );
  });
});
