import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentSnapshot, AgentTaskSnapshot } from "../../Core/Agent/AgentTypes";

const mocks = vi.hoisted(() => ({
  snapshot: {} as AgentSnapshot,
  listeners: new Set<() => void>(),
  send: vi.fn(),
  abort: vi.fn(),
  resume: vi.fn(),
  sync: vi.fn(),
  refresh: vi.fn(),
  command: vi.fn(),
  config: vi.fn(),
  newSession: vi.fn(),
}));
vi.mock("../../Core/Agent/AgentService", () => ({
  AgentService: {
    getSnapshot: () => mocks.snapshot,
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
    send: mocks.send,
    abort: mocks.abort,
    resume: mocks.resume,
    refreshConfig: mocks.refresh,
    newSession: mocks.newSession,
    switchSession: vi.fn(async () => undefined),
  },
}));
vi.mock("../../Core/Agent/AgentToolExecutor", () => ({
  getAgentPermission: () => "read",
  syncAgentExecutorRegistration: mocks.sync,
}));
vi.mock("../../Core/Commands/CommandRegistry", () => ({
  CommandRegistry: { execute: mocks.command },
}));
vi.mock("../../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: { update: mocks.config },
}));
vi.mock("../../Foundation/I18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
}));

import { AiAssistantPanel, buildConversation } from "./AiAssistantPanel";

function task(id: string, patch: Partial<AgentTaskSnapshot> = {}): AgentTaskSnapshot {
  return {
    id,
    sessionId: id,
    title: id,
    input: "",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    steps: [],
    queuedInputs: [],
    pendingApproval: null,
    activeCheckpointId: null,
    lastError: null,
    ...patch,
  };
}
function snapshot(activeTask: AgentTaskSnapshot): AgentSnapshot {
  return {
    sessions: [],
    sessionTasks: [activeTask],
    taskHistory: [],
    activeTaskId: activeTask.id,
    activeTask,
    configured: true,
    agentEnabled: true,
    cardEnabled: true,
    profiles: [{ id: "model", model: "example", name: "Example", protocol: "responses" }],
    activeProfileId: "model",
  };
}
function publish(next: AgentSnapshot) {
  act(() => {
    mocks.snapshot = next;
    for (const listener of mocks.listeners) listener();
  });
}
function draft() {
  return screen.getByRole("textbox");
}
function event(
  seq: number,
  type: AgentEvent["type"],
  content: string,
  stepId?: string,
): AgentEvent {
  return {
    id: String(seq),
    seq,
    taskId: "conversation",
    timestamp: seq * 1000,
    type,
    payload: { content },
    stepId,
  };
}
let run = 0;
describe("AI conversation interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshot = snapshot(task(`test-${++run}`));
    mocks.send.mockResolvedValue(undefined);
    mocks.abort.mockResolvedValue(undefined);
    mocks.resume.mockResolvedValue(undefined);
    mocks.sync.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue(undefined);
    mocks.command.mockResolvedValue({ ok: true });
  });
  afterEach(cleanup);

  it("opens AI settings with a retained destination", async () => {
    render(<AiAssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "ai.agentUi.openSettings" }));
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith("workbench.action.openSettings", {
        section: "ai",
      }),
    );
  });

  it("preserves each session draft and restores it when the panel remounts", () => {
    const first = mocks.snapshot;
    const view = render(<AiAssistantPanel />);
    fireEvent.change(draft(), { target: { value: "first draft" } });
    publish(snapshot(task(`second-${run}`)));
    expect(draft()).toHaveValue("");
    fireEvent.change(draft(), { target: { value: "second draft" } });
    publish(first);
    expect(draft()).toHaveValue("first draft");
    view.unmount();
    render(<AiAssistantPanel />);
    expect(draft()).toHaveValue("first draft");
  });

  it("submits Enter once while protecting IME composition and newlines", async () => {
    render(<AiAssistantPanel />);
    fireEvent.change(draft(), { target: { value: "inspect workspace" } });
    fireEvent.keyDown(draft(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(draft(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(draft(), { key: "Enter", keyCode: 229 });
    expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.keyDown(draft(), { key: "Enter" });
    fireEvent.keyDown(draft(), { key: "Enter" });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledExactlyOnceWith("inspect workspace"));
    expect(draft()).toHaveValue("");
  });

  it("separates queue and stop while preventing accidental session interruption", async () => {
    mocks.snapshot = snapshot(
      task(`running-${run}`, { status: "running", queuedInputs: ["later"] }),
    );
    render(<AiAssistantPanel />);
    expect(screen.getByRole("button", { name: "ai.agentUi.newTask" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ai.agentUi.sessions" })).toBeDisabled();
    fireEvent.change(draft(), { target: { value: "add tests" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.agentUi.queueTask" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("add tests"));
    expect(mocks.abort).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ai.agentUi.stopTask" }));
    expect(mocks.abort).toHaveBeenCalledOnce();
  });

  it("keeps a draft if executor synchronization fails", async () => {
    render(<AiAssistantPanel />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    mocks.sync.mockRejectedValueOnce(new Error("configuration unavailable"));
    fireEvent.change(draft(), { target: { value: "keep this" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.agentUi.sendTask" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("configuration unavailable"),
    );
    expect(draft()).toHaveValue("keep this");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("restores a rejected message without replacing a newly typed draft", async () => {
    let reject!: (error: Error) => void;
    mocks.send.mockReturnValueOnce(
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
    );
    render(<AiAssistantPanel />);
    fireEvent.change(draft(), { target: { value: "first attempt" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.agentUi.sendTask" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    fireEvent.change(draft(), { target: { value: "new instruction" } });
    await act(async () => reject(new Error("send failed")));
    expect(draft()).toHaveValue("new instruction");
  });

  it("follows streaming at the bottom and preserves the reader's position above it", async () => {
    await act(async () => {
      render(<AiAssistantPanel />);
    });
    const conversation = screen.getByRole("main", { name: "ai.agentUi.conversation" });
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    conversation.scrollTop = 100;
    fireEvent.scroll(conversation);
    const first = event(1, "step.delta", "a", "reply");
    publish(snapshot(task(mocks.snapshot.activeTask.id, { status: "running", events: [first] })));
    expect(conversation.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: "ai.agentUi.latest" }));
    expect(conversation.scrollTop).toBe(1000);
    Object.defineProperty(conversation, "scrollHeight", { value: 1200 });
    publish(
      snapshot(
        task(mocks.snapshot.activeTask.id, {
          status: "running",
          events: [first, event(2, "step.delta", "b", "reply")],
        }),
      ),
    );
    expect(conversation.scrollTop).toBe(1200);
  });

  it("retains long conversations and coalesces stream chunks without duplicating final text", () => {
    const events = Array.from({ length: 130 }, (_, index) =>
      event(index + 1, "task.steered", `message-${index}`),
    );
    events.push(
      event(131, "step.delta", "Hello", "reply"),
      event(132, "step.delta", " world", "reply"),
      event(133, "step.completed", "Hello world", "reply"),
    );
    const items = buildConversation([task("conversation", { status: "completed", events })]);
    expect(items).toHaveLength(131);
    expect(items[0]).toMatchObject({ type: "user", content: "message-0" });
    expect(items.at(-1)).toMatchObject({ type: "assistant", content: "Hello world" });
  });

  it("uses the final answer if the transport omitted a stream chunk", () => {
    const items = buildConversation([
      task("conversation", {
        events: [
          event(1, "step.delta", "partial", "reply"),
          event(2, "step.completed", "complete answer", "reply"),
        ],
      }),
    ]);
    expect(items).toEqual([
      { type: "assistant", id: "conversation-assistant-reply", content: "complete answer" },
    ]);
  });

  it("keeps inspectable tool input and a bounded output in the completed summary", () => {
    const requested = {
      ...event(1, "tool.requested", "", "tool"),
      payload: { name: "read_file", arguments: '{"path":"main.ts"}' },
    };
    const completed = event(2, "tool.completed", "x".repeat(5000), "tool");
    const items = buildConversation([
      task("conversation", { status: "completed", events: [requested, completed] }),
    ]);
    expect(items[0]).toMatchObject({
      type: "run-summary",
      tools: [
        {
          name: "read_file",
          input: '{"path":"main.ts"}',
          status: "completed",
          detail: `${"x".repeat(4000)}…`,
        },
      ],
    });
  });
});
