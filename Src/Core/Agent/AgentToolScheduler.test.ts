import { scheduleAgentTools } from "./AgentToolScheduler";
import type { AgentToolMetadata } from "./AgentTypes";

const read: AgentToolMetadata = {
  name: "read",
  description: "",
  inputSchema: {},
  effects: ["filesystem.read"],
  permission: "read",
  checkpointPolicy: "never",
  recoverability: "fully-recoverable",
  parallelSafety: "readonly",
};

describe("Agent tool scheduling", () => {
  it("settles sibling reads before returning a failure and never starts later writes", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let siblingFinished = false;
    const started: string[] = [];
    const operation = scheduleAgentTools(
      ["fail", "pending", "write"],
      (call) => (call === "write" ? { ...read, effects: ["filesystem.write"] } : read),
      async (call) => {
        started.push(call);
        if (call === "fail") throw new Error("failed read");
        await pending;
        siblingFinished = true;
        return call;
      },
      new AbortController().signal,
    );
    let settled = false;
    const rejection = expect(operation)
      .rejects.toThrow("failed read")
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await rejection;
    expect(siblingFinished).toBe(true);
    expect(started).toEqual(["fail", "pending"]);
  });

  it("runs at most four independent reads and retains response order", async () => {
    let active = 0;
    let peak = 0;
    const result = await scheduleAgentTools(
      Array.from({ length: 10 }, (_, i) => i),
      () => read,
      async (i) => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, (10 - i) * 2));
        active--;
        return i;
      },
      new AbortController().signal,
    );
    expect(peak).toBe(4);
    expect(result).toEqual(Array.from({ length: 10 }, (_, i) => i));
  });

  it("does not move reads across writes or conflicting tools", async () => {
    let value = 0;
    const trace: string[] = [];
    const results = await scheduleAgentTools(
      ["before", "write", "after", "conflict"],
      (call) =>
        call === "write"
          ? { ...read, effects: ["filesystem.write"] }
          : { ...read, conflictScopes: ["document"] },
      async (call) => {
        trace.push(call);
        await Promise.resolve();
        if (call === "write") value++;
        return value;
      },
      new AbortController().signal,
    );
    expect(trace).toEqual(["before", "write", "after", "conflict"]);
    expect(results).toEqual([0, 1, 1, 1]);
  });

  it("never starts another batch after cancellation", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await scheduleAgentTools(
      [0, 1, 2, 3, 4],
      () => read,
      async (i) => {
        started.push(i);
        controller.abort();
        return i;
      },
      controller.signal,
    );
    expect(started).toEqual([0, 1, 2, 3]);
  });
});
