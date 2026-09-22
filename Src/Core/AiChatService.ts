import { type I18nKey, LocaleService } from "../Foundation/I18n";
import {
  type AiChatDeltaPayload,
  type AiChatDonePayload,
  type AiChatErrorPayload,
  type AiChatErrorCode,
  type AiChatToolCallDelta,
  AiIPC,
} from "../Foundation/IPC/AiCommands";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";

/**
 * AI 助手纯聊天服务（模块级单例，useSyncExternalStore 消费）。
 *
 * 0.4.7 架构重做：
 * - 消息状态机 status（pending/streaming/done/error/stopped）与 phase（idle/connecting/streaming）
 * - 错误与内容分离：错误不写入 content、不进入下一轮上下文（修复上下文污染）
 * - 多会话（localStorage v2，v1 一次性迁移），支持新建/切换/删除/重试
 * - tool_calls 协议预留：增量聚合存储，本版不执行
 *
 * 不接编辑器上下文、不做 agent/工具/RAG——纯 OpenAI 兼容流式聊天。
 */

/** v1 历史键（迁移源，迁移成功后移除） */
const HISTORY_KEY_V1 = "aurona.ai.chat.history.v1";
/** v2 多会话存储键 */
const HISTORY_KEY_V2 = "aurona.ai.chat.sessions.v2";
/** 会话数上限 */
const SESSION_LIMIT = 20;
/** 每会话消息历史上限（条） */
const HISTORY_LIMIT = 100;
/** 送入模型的多轮上下文最多保留最近 20 条 */
const CONTEXT_WINDOW = 20;

/**
 * 系统提示词：面向代码编辑器场景的专业助手身份与输出规范
 */
const SYSTEM_PROMPT = [
  "You are Aurona Assistant, the built-in AI of Aurona Code, a lightweight desktop code editor.",
  "Reply in the same language the user writes in.",
  "",
  "Guidelines:",
  "- Be concise and precise. Lead with the answer; add explanation only when it aids understanding.",
  "- Format with Markdown: use fenced code blocks with a language tag for code, backticks for identifiers.",
  "- When writing code, prefer complete, runnable snippets over fragments, and follow the user's existing style and naming.",
  "- Never invent APIs, files, or project details. When uncertain, say so and state what information you would need.",
  "- Skip filler, apologies, and restating the question.",
].join("\n");

export interface AiChatToolCall {
  index: number;
  id?: string;
  name?: string;
  /** 按 index 增量聚合后的完整 arguments 片段 */
  arguments: string;
}

export type AiChatMessageStatus = "pending" | "streaming" | "done" | "error" | "stopped";

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: AiChatMessageStatus;
  createdAt: number;
  /** 生成耗时（完成/出错/中止时记录） */
  durationMs?: number;
  model?: string;
  finishReason?: string;
  /** 错误信息（与 content 分离，不进入下一轮上下文） */
  error?: { code: AiChatErrorCode; message: string };
  /** 模型请求的工具调用（0.4.7 仅聚合存储，不执行） */
  toolCalls?: AiChatToolCall[];
}

export interface AiChatSessionMeta {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export type AiChatPhase = "idle" | "connecting" | "streaming";

export interface AiChatSnapshot {
  sessions: AiChatSessionMeta[];
  activeSessionId: string;
  messages: AiChatMessage[];
  phase: AiChatPhase;
  /** 当前生成开始时间（ms，用于耗时显示；null 表示空闲） */
  startedAtMs: number | null;
  /** 最近一条错误提示（已翻译），null 表示无 */
  lastError: string | null;
  /** 是否已配置 apiKey/baseUrl */
  configured: boolean;
  /** 侧边栏 AI 卡片是否启用（ai.enabled，默认开启） */
  cardEnabled: boolean;
}

interface StoredSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AiChatMessage[];
}

interface ChatStore {
  activeSessionId: string;
  sessions: StoredSession[];
}

type ChatListener = () => void;

/** 生成会话/消息 id */
function createId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** 会话标题：取首条用户消息前 24 字符 */
function sessionTitle(messages: AiChatMessage[]): string {
  const firstUser = messages.find((item) => item.role === "user");
  const text = firstUser?.content.trim() ?? "";
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

function emptySession(id?: string): StoredSession {
  return {
    id: id && id.trim() !== "" ? id : createId(),
    title: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

/** 恢复中断遗留的瞬态状态：应用关闭时仍在流式的消息标记为已停止 */
function sanitizeMessage(item: AiChatMessage): AiChatMessage | null {
  if (
    !item ||
    typeof item !== "object" ||
    typeof item.id !== "string" ||
    (item.role !== "user" && item.role !== "assistant") ||
    typeof item.content !== "string"
  ) {
    return null;
  }
  const status: AiChatMessageStatus =
    item.status === "pending" || item.status === "streaming"
      ? "stopped"
      : item.status === "error" || item.status === "stopped"
        ? item.status
        : "done";
  return {
    id: item.id,
    role: item.role,
    content: item.content,
    status,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
    durationMs: typeof item.durationMs === "number" ? item.durationMs : undefined,
    model: typeof item.model === "string" ? item.model : undefined,
    finishReason: typeof item.finishReason === "string" ? item.finishReason : undefined,
    error: item.error ?? undefined,
    toolCalls: Array.isArray(item.toolCalls) ? item.toolCalls : undefined,
  };
}

function sanitizeSession(session: StoredSession): StoredSession | null {
  if (!session || typeof session !== "object" || typeof session.id !== "string") return null;
  const messages = Array.isArray(session.messages)
    ? session.messages
        .map(sanitizeMessage)
        .filter((item): item is AiChatMessage => item !== null)
        .slice(-HISTORY_LIMIT)
    : [];
  return {
    id: session.id,
    title: typeof session.title === "string" ? session.title : "",
    createdAt: typeof session.createdAt === "number" ? session.createdAt : Date.now(),
    updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : Date.now(),
    messages,
  };
}

/** v1 历史迁移：旧单会话数组 → 新会话结构（成功后移除 v1 键） */
function migrateV1(): ChatStore | null {
  try {
    const raw = localStorage.getItem(HISTORY_KEY_V1);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const messages = parsed
      .map((item) =>
        sanitizeMessage({
          ...(item as AiChatMessage),
          status: "done",
          createdAt: Date.now(),
        }),
      )
      .filter((item): item is AiChatMessage => item !== null);
    localStorage.removeItem(HISTORY_KEY_V1);
    if (messages.length === 0) return null;
    const session: StoredSession = {
      id: createId(),
      title: sessionTitle(messages),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages,
    };
    return { activeSessionId: session.id, sessions: [session] };
  } catch {
    return null;
  }
}

function loadStore(): ChatStore {
  try {
    const raw = localStorage.getItem(HISTORY_KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ChatStore> | null;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.sessions)) {
        const sessions = parsed.sessions
          .map(sanitizeSession)
          .filter((item): item is StoredSession => item !== null)
          .slice(0, SESSION_LIMIT);
        if (sessions.length > 0) {
          const activeSessionId =
            typeof parsed.activeSessionId === "string" &&
            sessions.some((session) => session.id === parsed.activeSessionId)
              ? parsed.activeSessionId
              : sessions[0].id;
          return { activeSessionId, sessions };
        }
      }
    }
  } catch {
    // 存储损坏时回退迁移/空态
  }
  return migrateV1() ?? (() => {
    const created = emptySession();
    return { activeSessionId: created.id, sessions: [created] };
  })();
}

function persistStore(current: ChatStore): void {
  try {
    const clamped: ChatStore = {
      activeSessionId: current.activeSessionId,
      sessions: current.sessions.slice(0, SESSION_LIMIT).map((session) => ({
        ...session,
        messages: session.messages.slice(-HISTORY_LIMIT),
      })),
    };
    localStorage.setItem(HISTORY_KEY_V2, JSON.stringify(clamped));
  } catch {
    // 本地存储不可用时静默跳过（隐私优先：历史仅存本地）
  }
}

/** 错误 code → 友好文案（i18n） */
export function describeAiError(code: AiChatErrorCode, message: string): string {
  const key: I18nKey =
    code === "connect"
      ? "ai.errorConnect"
      : code === "auth"
        ? "ai.errorAuth"
        : code === "rate_limit"
          ? "ai.errorRateLimit"
          : code === "first_token_timeout"
            ? "ai.errorFirstTokenTimeout"
            : code === "idle_timeout"
              ? "ai.errorIdleTimeout"
              : code === "timeout"
                ? "ai.errorTimeout"
                : "ai.errorGeneric";
  const text = LocaleService.translate(key);
  return code === "generic" ? text.replace("{message}", message) : text;
}

/** 按 index 聚合 tool_calls 增量 */
function mergeToolCalls(
  existing: AiChatToolCall[] | undefined,
  deltas: AiChatToolCallDelta[],
): AiChatToolCall[] {
  const list = existing ? [...existing] : [];
  for (const delta of deltas) {
    while (list.length <= delta.index) {
      list.push({ index: list.length, arguments: "" });
    }
    const current = list[delta.index];
    list[delta.index] = {
      index: delta.index,
      id: delta.id ?? current.id,
      name: delta.name ?? current.name,
      arguments: current.arguments + (delta.argumentsDelta ?? ""),
    };
  }
  return list;
}

let store: ChatStore = loadStore();
if (!localStorage.getItem(HISTORY_KEY_V2)) {
  persistStore(store);
}

let snapshot: AiChatSnapshot = {
  sessions: [],
  activeSessionId: store.activeSessionId,
  messages: [],
  phase: "idle",
  startedAtMs: null,
  lastError: null,
  configured: false,
  cardEnabled: true,
};

const listeners = new Set<ChatListener>();

/** 当前进行中的生成（null 表示空闲） */
let activeGeneration: {
  generationId: string;
  chatSessionId: string;
  assistantMessageId: string;
  startedAtMs: number;
} | null = null;

/** 当前生成是否已收到首个增量（connecting → streaming 分相） */
let receivedFirstDelta = false;

// 模块初始化时按存储构建一次快照（恢复历史会话，UI 首帧即有数据）
publish();

function activeSession(): StoredSession | undefined {
  return store.sessions.find((session) => session.id === store.activeSessionId);
}

/** 确保存在活动会话（空存储/失效 id 时补建） */
function ensureActiveSession(): StoredSession {
  const existing = activeSession();
  if (existing) return existing;
  const created = emptySession();
  store = { activeSessionId: created.id, sessions: [created, ...store.sessions] };
  return created;
}

function publish(): void {
  const session = activeSession();
  const phase: AiChatPhase = !activeGeneration
    ? "idle"
    : receivedFirstDelta
      ? "streaming"
      : "connecting";
  snapshot = {
    sessions: [...store.sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => ({
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
        messageCount: item.messages.length,
      })),
    activeSessionId: store.activeSessionId,
    messages: session ? session.messages : [],
    phase,
    startedAtMs: activeGeneration?.startedAtMs ?? null,
    lastError: snapshot.lastError,
    configured: snapshot.configured,
    cardEnabled: snapshot.cardEnabled,
  };
  for (const listener of listeners) listener();
}

/** 修改活动会话消息并可选落盘 */
function updateActiveMessages(
  updater: (messages: AiChatMessage[]) => AiChatMessage[],
  options: { persist?: boolean } = {},
): void {
  const session = activeSession();
  if (!session) return;
  session.messages = updater(session.messages);
  session.title = sessionTitle(session.messages);
  session.updatedAt = Date.now();
  // 最近更新的会话排到最前（快照按 updatedAt 排序，存储保持同序便于裁剪）
  store.sessions = [session, ...store.sessions.filter((item) => item.id !== session.id)];
  if (options.persist) persistStore(store);
  publish();
}

/** 按 id 修改指定 assistant 消息（生成收尾统一走这里，不依赖 activeGeneration） */
function patchAssistantById(
  messageId: string,
  patch: (message: AiChatMessage) => AiChatMessage,
  options: { persist?: boolean } = {},
): void {
  updateActiveMessages((messages) => {
    const index = messages.findIndex((item) => item.id === messageId);
    if (index < 0) return messages;
    const next = [...messages];
    next[index] = patch(next[index]);
    return next;
  }, options);
}

/** IPC 事件监听是否已注册 */
let eventsBound = false;

async function bindEvents(): Promise<void> {
  if (eventsBound) return;
  eventsBound = true;
  await AiIPC.onChatDelta((payload: AiChatDeltaPayload) => {
    if (!activeGeneration || payload.sessionId !== activeGeneration.generationId) return;
    receivedFirstDelta = true;
    const assistantMessageId = activeGeneration.assistantMessageId;
    patchAssistantById(assistantMessageId, (message) => ({
      ...message,
      status: "streaming",
      content: message.content + payload.delta,
      toolCalls: payload.toolCalls?.length
        ? mergeToolCalls(message.toolCalls, payload.toolCalls)
        : message.toolCalls,
    }));
  });
  await AiIPC.onChatDone((payload: AiChatDonePayload) => {
    if (!activeGeneration || payload.sessionId !== activeGeneration.generationId) return;
    const { assistantMessageId, startedAtMs } = activeGeneration;
    activeGeneration = null;
    const finishedAt = Date.now();
    patchAssistantById(
      assistantMessageId,
      (message) => ({
        ...message,
        status: payload.aborted ? "stopped" : "done",
        finishReason: payload.finishReason,
        durationMs: finishedAt - startedAtMs,
      }),
      { persist: true },
    );
    // 中止且无内容时移除空占位消息
    if (payload.aborted) {
      updateActiveMessages(
        (messages) =>
          messages.filter(
            (item) =>
              !(
                item.id === assistantMessageId &&
                item.content === "" &&
                !item.toolCalls?.length
              ),
          ),
        { persist: true },
      );
    }
  });
  await AiIPC.onChatError((payload: AiChatErrorPayload) => {
    if (!activeGeneration || payload.sessionId !== activeGeneration.generationId) return;
    const { assistantMessageId, startedAtMs } = activeGeneration;
    activeGeneration = null;
    const friendly = describeAiError(payload.code, payload.message);
    patchAssistantById(
      assistantMessageId,
      (message) => ({
        ...message,
        status: "error",
        durationMs: Date.now() - startedAtMs,
        error: { code: payload.code, message: payload.message },
      }),
      { persist: true },
    );
    snapshot = { ...snapshot, lastError: friendly };
    publish();
  });
}

export const AiChatService = {
  getSnapshot: (): AiChatSnapshot => snapshot,

  subscribe: (listener: ChatListener): (() => void) => {
    listeners.add(listener);
    void bindEvents();
    return () => listeners.delete(listener);
  },

  /** 重新读取 UserConfig 中的 AI 配置快照（设置保存后调用） */
  async refreshConfig(): Promise<void> {
    const config = await UserConfigStore.get();
    const ai = config.ai;
    const configured = Boolean(ai?.baseUrl?.trim() && ai?.apiKey?.trim());
    const cardEnabled = ai?.enabled !== false;
    if (configured !== snapshot.configured || cardEnabled !== snapshot.cardEnabled) {
      snapshot = { ...snapshot, configured, cardEnabled };
      publish();
    }
  },

  /** 发送一条用户消息并开始流式生成 */
  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || activeGeneration) return;
    ensureActiveSession();
    const userMessage: AiChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
      status: "done",
      createdAt: Date.now(),
    };
    updateActiveMessages((messages) => [...messages, userMessage]);
    await AiChatService.startGeneration();
  },

  /**
   * 开启一次生成（send 与 retry 共用入口）：创建 pending 占位 assistant 消息
   * 并发起 IPC。配置缺失时置错误提示。上下文 = system 提示词 + 最近 20 条
   * 已完成消息（错误/中止/空内容不进入，修复上下文污染）。
   */
  async startGeneration(): Promise<void> {
    if (activeGeneration) return;
    const config = await UserConfigStore.get();
    const ai = config.ai;
    const baseUrl = ai?.baseUrl?.trim();
    const apiKey = ai?.apiKey?.trim();
    const model = ai?.model?.trim();
    if (!baseUrl || !apiKey || !model) {
      snapshot = {
        ...snapshot,
        lastError: LocaleService.translate(
          !baseUrl || !apiKey ? "ai.errorNotConfigured" : "ai.errorModelMissing",
        ),
      };
      publish();
      return;
    }

    await bindEvents();
    ensureActiveSession();

    const generationId = createId();
    const assistantMessage: AiChatMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      status: "pending",
      createdAt: Date.now(),
      model,
    };
    const startedAtMs = Date.now();
    activeGeneration = {
      generationId,
      chatSessionId: store.activeSessionId,
      assistantMessageId: assistantMessage.id,
      startedAtMs,
    };
    receivedFirstDelta = false;
    updateActiveMessages((messages) => [...messages, assistantMessage]);
    snapshot = { ...snapshot, lastError: null };
    publish();

    const session = activeSession();
    const history = (session?.messages ?? [])
      .filter(
        (item) =>
          item.id !== assistantMessage.id &&
          (item.role === "user"
            ? item.content !== ""
            : item.status === "done" && item.content !== "" && !item.toolCalls?.length),
      )
      .slice(-CONTEXT_WINDOW)
      .map((item) => ({ role: item.role, content: item.content }));
    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];

    try {
      await AiIPC.send({ sessionId: generationId, baseUrl, apiKey, model, messages });
    } catch {
      // invoke 层失败（命令不可达等）：本地收尾并提示
      activeGeneration = null;
      const friendly = LocaleService.translate("ai.errorGeneric").replace(
        "{message}",
        LocaleService.translate("ai.errorUnavailable"),
      );
      patchAssistantById(
        assistantMessage.id,
        (message) => ({
          ...message,
          status: "error",
          durationMs: Date.now() - startedAtMs,
          error: { code: "generic", message: friendly },
        }),
        { persist: true },
      );
      snapshot = { ...snapshot, lastError: friendly };
      publish();
    }
  },

  /** 重试一条失败/中止的 assistant 消息（移除后以其前一条用户消息重发） */
  async retry(messageId: string): Promise<void> {
    if (activeGeneration) return;
    ensureActiveSession();
    const session = activeSession();
    if (!session) return;
    const index = session.messages.findIndex((item) => item.id === messageId);
    if (index < 1) return;
    const failed = session.messages[index];
    if (failed.role !== "assistant" || (failed.status !== "error" && failed.status !== "stopped")) {
      return;
    }
    const userMessage = session.messages[index - 1];
    if (userMessage.role !== "user") return;
    updateActiveMessages(
      (messages) => messages.filter((item) => item.id !== messageId),
      { persist: true },
    );
    await AiChatService.startGeneration();
  },

  /** 中止当前生成（IPC abort + 本地收尾：保留已生成内容并标记已停止） */
  async abort(): Promise<void> {
    if (!activeGeneration) return;
    const { generationId, assistantMessageId, startedAtMs } = activeGeneration;
    activeGeneration = null;
    patchAssistantById(
      assistantMessageId,
      (message) => ({
        ...message,
        status: "stopped",
        durationMs: Date.now() - startedAtMs,
      }),
      { persist: true },
    );
    // 无内容时移除空占位消息
    updateActiveMessages(
      (messages) =>
        messages.filter(
          (item) =>
            !(item.id === assistantMessageId && item.content === "" && !item.toolCalls?.length),
        ),
      { persist: true },
    );
    try {
      await AiIPC.abort(generationId);
    } catch {
      // 中止失败不影响本地状态（流可能已结束）
    }
  },

  /** 新建会话（当前会话为空时直接复用） */
  newSession(): void {
    if (activeGeneration) return;
    const session = activeSession();
    if (session && session.messages.length === 0) return;
    const created = emptySession();
    store = { activeSessionId: created.id, sessions: [created, ...store.sessions] };
    persistStore(store);
    snapshot = { ...snapshot, lastError: null };
    publish();
  },

  /** 切换会话（生成中先中止） */
  async switchSession(sessionId: string): Promise<void> {
    if (!store.sessions.some((session) => session.id === sessionId)) return;
    if (activeGeneration) await AiChatService.abort();
    store = { ...store, activeSessionId: sessionId };
    persistStore(store);
    snapshot = { ...snapshot, lastError: null };
    publish();
  },

  /** 删除会话（删除当前会话时切换到最近会话，无会话则新建） */
  async deleteSession(sessionId: string): Promise<void> {
    const target = store.sessions.find((session) => session.id === sessionId);
    if (!target) return;
    if (activeGeneration?.chatSessionId === sessionId) await AiChatService.abort();
    const remaining = store.sessions.filter((session) => session.id !== sessionId);
    if (remaining.length === 0) {
      const created = emptySession();
      store = { activeSessionId: created.id, sessions: [created] };
    } else if (sessionId === store.activeSessionId) {
      store = { activeSessionId: remaining[0].id, sessions: remaining };
    } else {
      store = { ...store, sessions: remaining };
    }
    persistStore(store);
    snapshot = { ...snapshot, lastError: null };
    publish();
  },

  /** 清空当前会话消息（生成中先中止） */
  async clear(): Promise<void> {
    if (activeGeneration) await AiChatService.abort();
    ensureActiveSession();
    updateActiveMessages(() => [], { persist: true });
    snapshot = { ...snapshot, lastError: null };
    publish();
  },
};
