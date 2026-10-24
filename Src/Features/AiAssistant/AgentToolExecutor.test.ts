import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiPreferences } from "../../Foundation/Types/Config";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  setExecutor: vi.fn(),
  approval: vi.fn(),
  confirm: vi.fn(),
  rename: vi.fn(),
  terminal: vi.fn(),
  command: vi.fn(),
}));
vi.mock("../../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: { get: mocks.get },
}));
vi.mock("../../Core/Agent/AgentService", () => ({
  AgentService: { setExecutor: mocks.setExecutor, notifyApproval: mocks.approval },
}));
vi.mock("../../Core/WorkspaceService", () => ({
  WorkspaceService: { getCurrent: () => ({ id: "workspace", primaryRoot: "C:/project" }) },
}));
vi.mock("../../Foundation/IPC/FileSystemCommands", () => ({
  FileSystemCommands: { rename: mocks.rename },
}));
vi.mock("../../Core/TerminalService", () => ({
  TerminalManager: { ensureDefaultTerminal: mocks.terminal, executeCommand: mocks.command },
}));
vi.mock("../../UI/Feedback/Toast", () => ({
  showConfirm: mocks.confirm,
  dismissNotification: vi.fn(),
}));

import { executeAgentToolCall, syncAgentExecutorRegistration } from "./AgentToolExecutor";

async function configure(ai: AiPreferences) {
  mocks.get.mockResolvedValue({ ai });
  await syncAgentExecutorRegistration();
}
function invoke(name: string, args: Record<string, unknown>) {
  return executeAgentToolCall({
    id: "call",
    taskId: "task",
    stepId: "step",
    name,
    arguments: JSON.stringify(args),
    signal: new AbortController().signal,
  });
}

describe("Agent settings wired to tool execution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.confirm.mockImplementation((options: { onCancel: () => void }) => options.onCancel());
    mocks.rename.mockResolvedValue(undefined);
    mocks.terminal.mockResolvedValue({ id: "terminal", name: "Terminal" });
    mocks.command.mockResolvedValue(undefined);
  });

  it("applies the independent write and command switches to real tool dispatch", async () => {
    await configure({
      agentPermission: "edit",
      agentRequireWriteApproval: false,
      agentRequireCommandApproval: true,
    });
    expect((await invoke("rename_file", { path: "old.ts", new_path: "new.ts" })).isError).toBe(
      false,
    );
    expect(mocks.rename).toHaveBeenCalledWith("C:/project/old.ts", "C:/project/new.ts");
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect((await invoke("terminal_run", { command: "echo test" })).isError).toBe(true);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.command).not.toHaveBeenCalled();
    mocks.confirm.mockClear();
    await configure({
      agentPermission: "edit",
      agentRequireWriteApproval: true,
      agentRequireCommandApproval: false,
    });
    expect((await invoke("terminal_run", { command: "echo test" })).isError).toBe(false);
    expect(mocks.command).toHaveBeenCalledWith("terminal", "echo test");
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect((await invoke("rename_file", { path: "old.ts", new_path: "new.ts" })).isError).toBe(
      true,
    );
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.rename).toHaveBeenCalledOnce();
  });

  it.each(["ask", "read"] as const)(
    "retains %s mode when approval switches are off",
    async (agentPermission) => {
      await configure({
        agentPermission,
        agentRequireWriteApproval: false,
        agentRequireCommandApproval: false,
      });
      expect((await invoke("rename_file", { path: "old.ts", new_path: "new.ts" })).isError).toBe(
        true,
      );
      expect(mocks.rename).not.toHaveBeenCalled();
      expect(mocks.confirm).toHaveBeenCalledTimes(agentPermission === "ask" ? 1 : 0);
    },
  );

  it("defaults edit-mode confirmation to enabled", async () => {
    await configure({ agentPermission: "edit" });
    expect((await invoke("rename_file", { path: "old.ts", new_path: "new.ts" })).isError).toBe(
      true,
    );
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("unregisters tools when either AI or Agent is disabled", async () => {
    await configure({ enabled: false, agentEnabled: true });
    expect(mocks.setExecutor).toHaveBeenLastCalledWith(null);
    await configure({ enabled: true, agentEnabled: false });
    expect(mocks.setExecutor).toHaveBeenLastCalledWith(null);
  });

  it("does not let an older configuration read re-enable the executor", async () => {
    let release!: (value: { ai: AiPreferences }) => void;
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const older = syncAgentExecutorRegistration();
    await configure({ enabled: false });
    release({ ai: { enabled: true, agentEnabled: true } });
    await older;
    expect(mocks.setExecutor).toHaveBeenCalledOnce();
    expect(mocks.setExecutor).toHaveBeenLastCalledWith(null);
  });
});
