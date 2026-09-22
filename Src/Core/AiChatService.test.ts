import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AiChatService 0.4.7 架构重做测试：
 * v1 迁移、phase 流转、错误与内容分离（上下文不污染）、重试、中止、多会话。
 */

/** 跨模块重置仍需共享的 mock 状态（vi.hoisted 保证提升顺序） */
const aiMock = vi.hoisted(() => {
  type ChatHandler = (payload: {
    sessionId: string;
    delta?: string;
    toolCalls?: Array<{ index: number; id?: string; name?: string; argumentsDelta?: string }>;
    aborted?: boolean;
    finishReason?: string;
    code?: string;
    message?: string;
  }) => void;
  const state: {
    handlers: { delta?: ChatHandler; done?: ChatHandler; error?: ChatHandler };
    sentPayloads: Array<{
      sessionId: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
    }>;
  } = {
    handlers: {},
    sentPayloads: [],
  };
  return state;
});

vi.mock("../Foundation/IPC/AiCommands", () => ({
  AiIPC: {
    send: vi.fn(async (payload: {
      sessionId: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
    }) => {
      aiMock.sentPayloads.push(payload);
    }),
    abort: vi.fn(async () => undefined),
    onChatStart: vi.fn(async () => undefined),
    onChatDelta: vi.fn(async (handler: (payload: never) => void) => {
      aiMock.handlers.delta = handler as never;
    }),
    onChatDone: vi.fn(async (handler: (payload: never) => void) => {
      aiMock.handlers.done = handler as never;
    }),
    onChatError: vi.fn(async (handler: (payload: never) => void) => {
      aiMock.handlers.error = handler as never;
    }),
  },
}));

vi.mock("../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: {
    get: vi.fn(async () => ({
      ai: {
        enabled: true,
        provider: "custom",
        baseUrl: "https://api.test/v1",
        apiKey: "test-key",
        model: "test-model",
      },
    })),
  },
}));

/** 每个用例重置模块注册表后动态加载服务（模块级单例状态随用例隔离） */
async function loadService() {
  vi.resetModules();
  const module = await import("./AiChatService");
  return module.AiChatService;
}

/** 完成一轮「send → delta → done」并返回最后一条 assistant 消息 */
async function runGeneration(service: Awaited<ReturnType<typeof loadService>>, text: string) {
  await service.send(text);
  const sessionId = aiMock.sentPayloads.at(-1)?.sessionId ?? "";
  aiMock.handlers.delta?.({ sessionId, delta: "部分回答" });
  aiMock.handlers.delta?.({ sessionId, delta: "，继续" });
  aiMock.handlers.done?.({ sessionId, aborted: false, finishReason: "stop" });
  return sessionId;
}

beforeEach(() => {
  localStorage.clear();
  aiMock.sentPayloads.length = 0;
  delete aiMock.handlers.delta;
  delete aiMock.handlers.done;
  delete aiMock.handlers.error;
});

describe("AiChatService", () => {
  it("v1 历史一次性迁移为多会话 v2 存储", async () => {
    localStorage.setItem(
      "aurona.ai.chat.history.v1",
      JSON.stringify([
        { id: "u1", role: "user", content: "第一问" },
        { id: "a1", role: "assistant", content: "第一答" },
      ]),
    );
    const service = await loadService();
    const snapshot = service.getSnapshot();
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages.every((item) => item.status === "done")).toBe(true);
    expect(localStorage.getItem("aurona.ai.chat.history.v1")).toBeNull();
    expect(localStorage.getItem("aurona.ai.chat.sessions.v2")).not.toBeNull();
  });

  it("send → delta → done 全链路：phase 流转与状态落定", async () => {
    const service = await loadService();
    service.subscribe(() => {});
    await service.send("你好");
    expect(service.getSnapshot().phase).toBe("connecting");
    const sessionId = aiMock.sentPayloads.at(-1)?.sessionId ?? "";
    aiMock.handlers.delta?.({ sessionId, delta: "回" });
    let snapshot = service.getSnapshot();
    expect(snapshot.phase).toBe("streaming");
    expect(snapshot.messages.at(-1)?.status).toBe("streaming");
    expect(snapshot.messages.at(-1)?.content).toBe("回");
    aiMock.handlers.done?.({ sessionId, aborted: false, finishReason: "stop" });
    snapshot = service.getSnapshot();
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.messages.at(-1)?.status).toBe("done");
    expect(snapshot.messages.at(-1)?.finishReason).toBe("stop");
    expect(typeof snapshot.messages.at(-1)?.durationMs).toBe("number");
  });

  it("请求载荷携带 system 提示词且上下文排除未完成消息", async () => {
    const service = await loadService();
    service.subscribe(() => {});
    await service.send("第一问");
    const first = aiMock.sentPayloads.at(-1);
    expect(first?.messages[0].role).toBe("system");
    expect(first?.messages[0].content).toContain("Aurona Assistant");
    expect(first?.messages.at(-1)).toMatchObject({ role: "user", content: "第一问" });
  });

  it("错误与内容分离：content 保留、错误字段独立、不进入下一轮上下文", async () => {
    const service = await loadService();
    service.subscribe(() => {});
    await runGeneration(service, "已完成的一问");
    await service.send("失败的一问");
    const errorSessionId = aiMock.sentPayloads.at(-1)?.sessionId ?? "";
    aiMock.handlers.delta?.({ sessionId: errorSessionId, delta: "生成到一半" });
    aiMock.handlers.error?.({
      sessionId: errorSessionId,
      code: "connect",
      message: "连接失败: boom",
    });
    let snapshot = service.getSnapshot();
    const failed = snapshot.messages.at(-1);
    expect(failed?.status).toBe("error");
    expect(failed?.content).toBe("生成到一半");
    expect(failed?.error?.code).toBe("connect");
    expect(snapshot.lastError).toBeTruthy();

    await service.send("后续一问");
    const payload = aiMock.sentPayloads.at(-1);
    const assistantContents = payload?.messages
      .filter((item) => item.role === "assistant")
      .map((item) => item.content);
    expect(assistantContents).toEqual(["部分回答，继续"]);
    expect(assistantContents).not.toContain("生成到一半");
  });

  it("retry 移除失败消息并以原用户消息重发", async () => {
    const service = await loadService();
    service.subscribe(() => {});
    await service.send("要重试的一问");
    const errorSessionId = aiMock.sentPayloads.at(-1)?.sessionId ?? "";
    aiMock.handlers.error?.({
      sessionId: errorSessionId,
      code: "timeout",
      message: "总时长超限",
    });
    const failedId = service.getSnapshot().messages.at(-1)?.id ?? "";
    const sendCallsBefore = aiMock.sentPayloads.length;
    await service.retry(failedId);
    expect(aiMock.sentPayloads.length).toBe(sendCallsBefore + 1);
    const snapshot = service.getSnapshot();
    expect(snapshot.messages.some((item) => item.id === failedId)).toBe(false);
    expect(snapshot.messages.at(-1)?.status).toBe("pending");
    expect(aiMock.sentPayloads.at(-1)?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "要重试的一问",
    });
  });

  it("abort 保留已生成内容并标记 stopped，空占位被移除", async () => {
    const service = await loadService();
    service.subscribe(() => {});
    await service.send("会被中止的一问");
    const sessionId = aiMock.sentPayloads.at(-1)?.sessionId ?? "";
    aiMock.handlers.delta?.({ sessionId, delta: "先写一半" });
    await service.abort();
    let snapshot = service.getSnapshot();
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.messages.at(-1)?.status).toBe("stopped");
    expect(snapshot.messages.at(-1)?.content).toBe("先写一半");

    // 无内容时占位消息应被移除
    await service.send("再来一次");
    const secondId = aiMock.sentPayloads.at(-1)?.sessionId ?? "";
    await service.abort();
    snapshot = service.getSnapshot();
    expect(snapshot.messages.some((item) => item.content === "" && item.role === "assistant")).toBe(
      false,
    );
    expect(secondId).toBeTruthy();
  });

  it("多会话：新建 / 切换 / 删除与消息隔离", async () => {
    const service = await loadService();
    service.subscribe(() => {});
    await runGeneration(service, "会话一的问题");
    const firstSnapshot = service.getSnapshot();
    const firstSessionId = firstSnapshot.activeSessionId;
    expect(firstSnapshot.messages).toHaveLength(2);

    service.newSession();
    let snapshot = service.getSnapshot();
    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.activeSessionId).not.toBe(firstSessionId);
    expect(snapshot.messages).toHaveLength(0);

    await service.switchSession(firstSessionId);
    snapshot = service.getSnapshot();
    expect(snapshot.activeSessionId).toBe(firstSessionId);
    expect(snapshot.messages).toHaveLength(2);

    await service.deleteSession(firstSessionId);
    snapshot = service.getSnapshot();
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.activeSessionId).not.toBe(firstSessionId);
    expect(snapshot.messages).toHaveLength(0);
  });

  it("clear 清空当前会话并重置错误提示", async () => {
    const service = await loadService();
    service.subscribe(() => {});
    await runGeneration(service, "待清空");
    await service.clear();
    const snapshot = service.getSnapshot();
    expect(snapshot.messages).toHaveLength(0);
    expect(snapshot.sessions).toHaveLength(1);
  });
});
