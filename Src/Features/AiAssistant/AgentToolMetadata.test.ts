import { describe, expect, it } from "vitest";
import {
  executeAgentToolCall,
  getAgentToolMetadata,
  getAgentToolPromptDocs,
} from "../../Core/Agent/AgentToolExecutor";

describe("Agent tool metadata", () => {
  it("declares checkpoint policy from effects instead of tool names", () => {
    const tools = getAgentToolMetadata();
    const edit = tools.find((tool) => tool.name === "edit_file");
    const read = tools.find((tool) => tool.name === "read_file");
    const command = tools.find((tool) => tool.name === "run_command");

    expect(edit).toMatchObject({
      permission: "approval-required",
      checkpointPolicy: "before-write",
      recoverability: "fully-recoverable",
    });
    expect(edit?.effects).toContain("filesystem.write");
    expect(command?.effects).toContain("workspace.change");
    expect(read).toMatchObject({ permission: "read", checkpointPolicy: "never" });
  });

  it("rejects invalid arguments before any approval prompt", async () => {
    const outcome = await executeAgentToolCall({
      id: "call-1",
      taskId: "task-1",
      stepId: "step-1",
      name: "edit_file",
      arguments: JSON.stringify({ path: "../outside", old_text: "x", new_text: "y" }),
      signal: new AbortController().signal,
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toMatch(/workspace|outside|path/i);
  });

  it("documents capability metadata in the prompt tool catalog", () => {
    const prompt = getAgentToolPromptDocs();
    expect(prompt).toContain("effects: filesystem.write, workspace.modify");
    expect(prompt).toContain("permission: approval-required");
    expect(prompt).toContain("checkpoint: before-write");
    expect(prompt).toContain("recovery: fully-recoverable");
  });

  it("skips a tool when the workspace snapshot changed before execution", async () => {
    const outcome = await executeAgentToolCall({
      id: "call-2",
      taskId: "task-1",
      stepId: "step-1",
      name: "read_file",
      arguments: JSON.stringify({ path: "README.md" }),
      signal: new AbortController().signal,
      workspaceId: "workspace:C:/a-different-root",
      workspaceRoot: "C:/a-different-root",
    });

    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("Workspace changed");
  });
});
