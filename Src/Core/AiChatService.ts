import { type I18nKey, LocaleService } from "../Foundation/I18n";
import {
  type AiChatDeltaPayload,
  type AiChatDonePayload,
  type AiChatErrorCode,
  type AiChatErrorPayload,
  type AiChatToolCallDelta,
  AiIPC,
  type AiIpcMessage,
  type AiIpcToolCall,
} from "../Foundation/IPC/AiCommands";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import type { AiProfile } from "../Foundation/Types/Config";
import { LEGACY_AI_PROFILE_ID, needsAiProfileMigration, resolveAiProfiles } from "./AiProfiles";

/**
 * AI 助手服务（模块级单例，useSyncExternalStore 消费）。
 *
 * 0.4.7：消息状态机、错误与内容分离、多会话、tool_calls 增量聚合（协议预留）。
 * 0.4.8 agent 化：tool_calls 执行端经 setAgentExecutor 注入（Core 不反向依赖
 * Features），done(finishReason=tool_calls) 进入「执行工具 → 回填结果 → 续轮」
 * 循环，轮数上限 MAX_AGENT_ROUNDS；上下文按 OpenAI tool 协议序列化。
 */

/** v1 历史键（迁移源，迁移成功后移除） */
const HISTORY_KEY_V1 = "aurona.ai.chat.history.v1";
/** v2 多会话存储键 */
const HISTORY_KEY_V2 = "aurona.ai.chat.sessions.v2";
/** 会话数上限 */
const SESSION_LIMIT = 20;
/** 每会话消息历史上限（条） */
const HISTORY_LIMIT = 100;
/** 送入模型的多轮上下文最多保留最近 20 条消息 */
const CONTEXT_WINDOW = 20;
/** agent 单次对话的最大工具轮数（超限注入收尾提示后做最后一轮） */
export const MAX_AGENT_ROUNDS = 25;

/**
 * 系统提示词基座：面向代码编辑器场景的专业助手身份与输出规范
 */
const SYSTEM_PROMPT_BASE = [
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

/**
 * agent 模式附加段：工具使用规范（对齐 codex 类编码 agent 的提示词惯例）
 */
const AGENT_PROMPT_SECTION = [
  "",
  "You operate as an agent inside the user's workspace. You have the following tools:",
  "",
  "{AGENT_TOOLS}",
  "",
  "Tool rules:",
  "1. Prefer tools over guessing. Read files or search the workspace before making claims about code.",
  "2. Read before you edit. Never modify a file you have not read in this conversation.",
  "3. Make minimal diffs with edit_file: replace the smallest unique span that achieves the change. Rewriting whole files is forbidden.",
  "4. Tool arguments are strict JSON. Match the parameter names exactly; never emit comments or trailing commas.",
  "5. Call one logical batch of tools per turn, then stop and wait for results. Do not assume outcomes of calls you have not seen.",
  "6. If a tool call fails, retry at most once with corrected arguments, then report the failure honestly.",
  "7. Write operations (edit_file, run_command) require user confirmation. If the user rejects an operation, do not retry it; adjust your plan or explain instead.",
  "8. Stay inside the workspace. Never attempt destructive commands or paths outside the workspace root.",
  "9. After tool results arrive, continue: summarize what changed and what remains, then finish with a concise final answer.",
].join("\n");

export interface AiChatToolCall {
  index: number;
  id?: string;
  name?: string;
  /** 按 index 增量聚合后的完整 arguments 片段 */
  arguments: string;
}

/** 单条工具执行结果（agent loop 回填，UI 工具卡片消费） */
export interface AiChatToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
}

/** agent 执行端注入接口（Core 不反向依赖 Features，由 Features 侧注册） */
export interface AiAgentExecutor {
  execute(invocation: { id: string; name: string; arguments: string }): Promise<{
    content: string;
    isError: boolean;
  }>;
  /** 系统提示词中追加的工具清单文档 */
  toolPrompt: string;
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
  /** 模型请求的工具调用（按 index 聚合） */
  toolCalls?: AiChatToolCall[];
  /** 工具执行结果（agent loop 回填，与 toolCalls 按 toolCallId 对应） */
  toolResults?: AiChatToolResult[];
}

export interface AiChatSessionMeta {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export type AiChatPhase = "idle" | "connecting" | "streaming";

/** 配置档摘要（快照消费；不含 apiKey，避免 UI 层泄漏密钥） */
export interface AiChatProfileSummary {
  id: string;
  name: string;
  provider?: AiProfile["provider"];
  model: string;
}

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
  /** 模型配置档摘要（不含 apiKey） */
  profiles: AiChatProfileSummary[];
  /** 当前激活配置档 id（null 表示未配置） */
  activeProfileId: string | null;
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
    toolResults: Array.isArray(item.toolResults) ? item.toolResults : undefined,
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
  return (
    migrateV1() ??
    (() => {
      const created = emptySession();
      return { activeSessionId: created.id, sessions: [created] };
    })()
  );
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

/** 生成系统提示词：基座 + agent 工具段（执行端已注册时） */
function buildSystemPrompt(): string {
  if (!agentExecutor) return SYSTEM_PROMPT_BASE;
  return `${SYSTEM_PROMPT_BASE}\n${AGENT_PROMPT_SECTION.replace(
    "{AGENT_TOOLS}",
    agentExecutor.toolPrompt,
  )}`;
}

/**
 * 组装模型上下文：user/assistant 直传；带 toolCalls 的 assistant 按 OpenAI tool
 * 协议展开为 assistant(toolCalls) + 若干 role:"tool" 结果消息。仅当工具结果齐全
 * 时才展开（应用重启可能丢失未持久化的中间结果，此时降级为纯文本）。
 */
function buildContextMessages(assistantMessageId: string): AiIpcMessage[] {
  const session = activeSession();
  const relevant = (session?.messages ?? []).filter(
    (item) =>
      item.id !== assistantMessageId &&
      (item.role === "user"
        ? item.content !== ""
        : item.status === "done" && (item.content !== "" || item.toolCalls?.length)),
  );
  const history: AiIpcMessage[] = [];
  for (const item of relevant.slice(-CONTEXT_WINDOW)) {
    if (item.role === "user") {
      history.push({ role: "user", content: item.content });
      continue;
    }
    const resultsComplete =
      (item.toolResults?.length ?? 0) >= (item.toolCalls?.length ?? 0) &&
      (item.toolCalls?.length ?? 0) > 0;
    if (item.toolCalls?.length && resultsComplete) {
      const toolCalls: AiIpcToolCall[] = item.toolCalls.map((call) => ({
        id: call.id ?? `call_${call.index}`,
        type: "function",
        function: { name: call.name ?? "", arguments: call.arguments },
      }));
      history.push({
        role: "assistant",
        content: item.content !== "" ? item.content : undefined,
        toolCalls,
      });
      for (const result of item.toolResults ?? []) {
        history.push({ role: "tool", toolCallId: result.toolCallId, content: result.content });
      }
      continue;
    }
    if (item.content !== "") history.push({ role: "assistant", content: item.content });
  }
  return history;
}

/** agent 工具轮：顺序执行本轮全部工具调用并增量回填结果，随后开启续轮 */
async function runAgentToolRound(generation: {
  generationId: string;
  assistantMessageId: string;
  round: number;
}): Promise<void> {
  const session = activeSession();
  const message = session?.messages.find((item) => item.id === generation.assistantMessageId);
  const calls = message?.toolCalls ?? [];
  const results: AiChatToolResult[] = [];
  for (const call of calls) {
    // abort 会在 activeGeneration 上置空：每次执行前检查，被中止则停止整链
    if (!activeGeneration || activeGeneration.generationId !== generation.generationId) return;
    const toolCallId = call.id ?? `call_${call.index}`;
    let outcome: { content: string; isError: boolean };
    if (!agentExecutor) {
      outcome = { content: LocaleService.translate("ai.toolExecutionDisabled"), isError: true };
    } else {
      outcome = await agentExecutor.execute({
        id: toolCallId,
        name: call.name ?? "",
        arguments: call.arguments,
      });
    }
    results.push({
      toolCallId,
      name: call.name ?? "",
      content: outcome.content,
      isError: outcome.isError,
    });
    patchAssistantById(
      generation.assistantMessageId,
      (item) => ({ ...item, toolResults: [...results] }),
      { persist: true },
    );
  }
  await startAgentFollowUp(generation);
}

/** 工具续轮：沿用会话开启新一轮生成（上下文已包含工具调用与结果） */
async function startAgentFollowUp(previous: {
  generationId: string;
  assistantMessageId: string;
  round: number;
}): Promise<void> {
  if (!activeGeneration || activeGeneration.generationId !== previous.generationId) return;
  activeGeneration = null;
  await AiChatService.startGeneration(previous.round + 1);
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
  profiles: [],
  activeProfileId: null,
};

const listeners = new Set<ChatListener>();

/** agent 执行端（Features 侧注册；null 表示未启用 agent 工具） */
let agentExecutor: AiAgentExecutor | null = null;

/** 当前进行中的生成（null 表示空闲） */
let activeGeneration: {
  generationId: string;
  chatSessionId: string;
  assistantMessageId: string;
  startedAtMs: number;
  /** 工具轮次（send 首轮为 0，工具续轮递增） */
  round: number;
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
    profiles: snapshot.profiles,
    activeProfileId: snapshot.activeProfileId,
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
    const generation = activeGeneration;
    const finishedAt = Date.now();
    patchAssistantById(
      generation.assistantMessageId,
      (message) => ({
        ...message,
        status: payload.aborted ? "stopped" : "done",
        finishReason: payload.finishReason,
        durationMs: finishedAt - generation.startedAtMs,
      }),
      { persist: true },
    );
    // 中止：整链停止，移除空占位消息
    if (payload.aborted) {
      activeGeneration = null;
      updateActiveMessages(
        (messages) =>
          messages.filter(
            (item) =>
              !(
                item.id === generation.assistantMessageId &&
                item.content === "" &&
                !item.toolCalls?.length
              ),
          ),
        { persist: true },
      );
      return;
    }
    // agent loop：模型请求工具且执行端可用 → 执行并续轮（activeGeneration 保持，UI 维持生成态）
    if (payload.finishReason === "tool_calls" && agentExecutor) {
      if (generation.round >= MAX_AGENT_ROUNDS) {
        // 轮数上限：注入收尾提示作为工具结果，做最后一轮让模型直接作答
        const session = activeSession();
        const calls =
          session?.messages.find((item) => item.id === generation.assistantMessageId)?.toolCalls ??
          [];
        patchAssistantById(
          generation.assistantMessageId,
          (item) => ({
            ...item,
            toolResults: calls.map((call) => ({
              toolCallId: call.id ?? `call_${call.index}`,
              name: call.name ?? "",
              content: LocaleService.translate("ai.agent.roundLimit"),
              isError: false,
            })),
          }),
          { persist: true },
        );
        void startAgentFollowUp(generation);
        return;
      }
      void runAgentToolRound(generation);
      return;
    }
    // 常规完成：收尾回到空闲
    activeGeneration = null;
    publish();
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
    // 0.4.8 及以前单配置无感迁移：profiles 为空且旧字段可用时一次性写回
    if (needsAiProfileMigration(ai)) {
      const resolved = resolveAiProfiles(ai);
      await UserConfigStore.set({
        ai: { ...ai, profiles: resolved.profiles, activeProfileId: LEGACY_AI_PROFILE_ID },
      });
    }
    const { profiles, active } = resolveAiProfiles(ai);
    const summaries: AiChatProfileSummary[] = profiles.map((item) => ({
      id: item.id,
      name: item.name,
      provider: item.provider,
      model: item.model,
    }));
    const configured = Boolean(active);
    const cardEnabled = ai?.enabled !== false;
    if (
      configured !== snapshot.configured ||
      cardEnabled !== snapshot.cardEnabled ||
      active?.id !== snapshot.activeProfileId ||
      JSON.stringify(summaries) !== JSON.stringify(snapshot.profiles)
    ) {
      snapshot = {
        ...snapshot,
        configured,
        cardEnabled,
        profiles: summaries,
        activeProfileId: active?.id ?? null,
      };
      publish();
    }
  },

  /** 切换激活配置档（设置页与聊天顶栏共用；保存后刷新快照） */
  async setActiveProfile(id: string): Promise<void> {
    const config = await UserConfigStore.get();
    if (config.ai?.activeProfileId === id) return;
    await UserConfigStore.set({ ai: { ...config.ai, activeProfileId: id } });
    await AiChatService.refreshConfig();
  },

  /** 注册/注销 agent 执行端（Features 侧调用；null 关闭工具执行与工具提示词段） */
  setAgentExecutor(executor: AiAgentExecutor | null): void {
    agentExecutor = executor;
    publish();
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
   * 开启一次生成（send / retry / agent 续轮共用入口）：创建 pending 占位
   * assistant 消息并发起 IPC。配置缺失时置错误提示。上下文 = 系统提示词
   * （agent 模式含工具规范）+ 最近 20 条已完成消息（错误/中止/空内容不进入）。
   */
  async startGeneration(round = 0): Promise<void> {
    if (activeGeneration) return;
    const config = await UserConfigStore.get();
    const { active } = resolveAiProfiles(config.ai);
    const baseUrl = active?.baseUrl.trim();
    const apiKey = active?.apiKey.trim();
    const model = active?.model.trim();
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
      round,
    };
    receivedFirstDelta = false;
    updateActiveMessages((messages) => [...messages, assistantMessage]);
    snapshot = { ...snapshot, lastError: null };
    publish();

    const messages: AiIpcMessage[] = [
      { role: "system", content: buildSystemPrompt() },
      ...buildContextMessages(assistantMessage.id),
    ];

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
    updateActiveMessages((messages) => messages.filter((item) => item.id !== messageId), {
      persist: true,
    });
    await AiChatService.startGeneration();
  },

  /** 中止当前生成/工具链（IPC abort + 本地收尾：保留已生成内容并标记已停止） */
  async abort(): Promise<void> {
    if (!activeGeneration) return;
    const { generationId, assistantMessageId, startedAtMs } = activeGeneration;
    activeGeneration = null;
    // 仅流式中的消息标记停止；已完成（含 tool_calls）的消息保留原状态
    patchAssistantById(
      assistantMessageId,
      (message) =>
        message.status === "pending" || message.status === "streaming"
          ? {
              ...message,
              status: "stopped",
              durationMs: Date.now() - startedAtMs,
            }
          : message,
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
