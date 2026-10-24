import { describe, expect, it } from "vitest";
import { resolveAgentToolAuthorization, shouldCreateAgentCheckpoint } from "./AgentPolicies";
import type { AgentToolEffect, AgentToolMetadata } from "./AgentTypes";

const readTool: AgentToolMetadata = {
  name: "read_file",
  description: "Read a file",
  inputSchema: {},
  effects: ["filesystem.read", "workspace.read"],
  permission: "read",
  checkpointPolicy: "never",
  recoverability: "fully-recoverable",
};

const writeTool: AgentToolMetadata = {
  name: "edit_file",
  description: "Edit a file",
  inputSchema: {},
  effects: ["filesystem.write", "workspace.modify"],
  permission: "approval-required",
  checkpointPolicy: "before-write",
  recoverability: "fully-recoverable",
};

const commandTool: AgentToolMetadata = {
  name: "terminal_run",
  description: "Run a command",
  inputSchema: {},
  effects: ["process.execute"],
  permission: "approval-required",
  checkpointPolicy: "before-write",
  recoverability: "partially-recoverable",
};

describe("Agent user-selected safety policies", () => {
  it("confirms every tool in ask mode and blocks mutations in read mode", () => {
    const approvals = { requireWriteApproval: false, requireCommandApproval: false };
    expect(resolveAgentToolAuthorization("ask", readTool, approvals)).toBe("confirm");
    expect(resolveAgentToolAuthorization("read", readTool, approvals)).toBe("allow");
    expect(resolveAgentToolAuthorization("read", writeTool, approvals)).toBe("deny");
    expect(resolveAgentToolAuthorization("read", commandTool, approvals)).toBe("deny");
  });

  it("applies independent write and command approval switches in edit mode", () => {
    expect(
      resolveAgentToolAuthorization("edit", writeTool, {
        requireWriteApproval: true,
        requireCommandApproval: false,
      }),
    ).toBe("confirm");
    expect(
      resolveAgentToolAuthorization("edit", writeTool, {
        requireWriteApproval: false,
        requireCommandApproval: true,
      }),
    ).toBe("allow");
    expect(
      resolveAgentToolAuthorization("edit", commandTool, {
        requireWriteApproval: false,
        requireCommandApproval: true,
      }),
    ).toBe("confirm");
    expect(
      resolveAgentToolAuthorization("edit", commandTool, {
        requireWriteApproval: true,
        requireCommandApproval: false,
      }),
    ).toBe("allow");
  });

  it("keeps an unclassified side effect behind confirmation", () => {
    expect(
      resolveAgentToolAuthorization(
        "edit",
        {
          ...writeTool,
          effects: ["workspace.modify", "network.request" as AgentToolEffect],
        },
        { requireWriteApproval: false, requireCommandApproval: false },
      ),
    ).toBe("confirm");
  });

  it("creates pre-write checkpoints by default and honors the opt-out", () => {
    expect(shouldCreateAgentCheckpoint(writeTool, true)).toBe(true);
    expect(shouldCreateAgentCheckpoint(writeTool, false)).toBe(false);
    expect(shouldCreateAgentCheckpoint(readTool, true)).toBe(false);
  });
});
