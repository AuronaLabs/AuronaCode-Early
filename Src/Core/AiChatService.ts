import { type I18nKey, LocaleService } from "../Foundation/I18n";
import { type AiChatErrorCode, type AiChatErrorPayload, AiIPC } from "../Foundation/IPC/AiCommands";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";

/**
 * 0.4.6 批次 5：AI 助手纯聊天服务（模块级单例，useSyncExternalStore 消费）。
 *
 * 职责：会话消息状态、流式事件消费、历史持久化（localStorage，仅本地）。
 * 不接编辑器上下文、不做 agent/工具/RAG——纯 OpenAI 兼容流式聊天。
 */

const HISTORY_KEY = "aurona.ai.chat.history.v1";
/** 持久化历史上限（条） */
const HISTORY_LIMIT = 100;
/** 送入模型的多轮上下文最多保留最近 20 条 */
const CONTEXT_WINDOW = 20;

/** 系统提示词：简洁通用助手，回复语言跟随用户 */
const SYSTEM_PROMPT =
  "You are a concise, general-purpose assistant built into the Aurona Code editor. " +
  "Answer clearly and directly. Always reply in the same language the user writes in.";

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** AI 消息流式生成中（尾部光标） */
  streaming?: boolean;
  /** 该条为错误提示 */
  error?: boolean;
}

export interface AiChatSnapshot {
  messages: AiChatMessage[];
  isGenerating: boolean;
  /** 最近一条错误提示（已翻译），null 表示无 */
  lastError: string | null;
  /** 是否已配置 apiKey/baseUrl */
  configured: boolean;
  /** 侧边栏 AI 卡片是否启用（ai.enabled，默认开启） */
  cardEnabled: boolean;
}

type ChatListener = () => void;

/** 从 localStorage 恢复历史（结构校验失败则返回空） */
function loadHistory(): AiChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is AiChatMessage =>
          !!item &&
          typeof item === "object" &&
          typeof (item as AiChatMessage).id === "string" &&
          ((item as AiChatMessage).role === "user" ||
            (item as AiChatMessage).role === "assistant") &&
          typeof (item as AiChatMessage).content === "string",
      )
      .map((item) => ({
        id: item.id,
        role: item.role,
        content: item.content,
      }))
      .slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function persistHistory(messages: AiChatMessage[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-HISTORY_LIMIT)));
  } catch {
    // 本地存储不可用时静默跳过（隐私优先：历史仅存本地）
  }
}

/** 生成会话/消息 id */
function createId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** 错误 code → 友好文案（i18n） */
function friendlyErrorMessage(code: AiChatErrorCode, message: string): string {
  const key: I18nKey =
    code === "connect"
      ? "ai.errorConnect"
      : code === "auth"
        ? "ai.errorAuth"
        : code === "rate_limit"
          ? "ai.errorRateLimit"
          : code === "timeout"
            ? "ai.errorTimeout"
            : "ai.errorGeneric";
  const text = LocaleService.translate(key);
  return code === "generic" ? text.replace("{message}", message) : text;
}

let snapshot: AiChatSnapshot = {
  messages: loadHistory(),
  isGenerating: false,
  lastError: null,
  configured: false,
  cardEnabled: true,
};

const listeners = new Set<ChatListener>();

/** 当前进行中的流式会话（null 表示空闲） */
let activeSession: { sessionId: string } | null = null;

function publish(next: AiChatSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function updateMessages(
  updater: (messages: AiChatMessage[]) => AiChatMessage[],
  options: { persist?: boolean } = {},
): void {
  const messages = updater(snapshot.messages);
  publish({ ...snapshot, messages });
  if (options.persist) persistHistory(messages);
}

/** 修改最后一条流式中的 assistant 消息 */
function patchStreamingAssistant(patch: (message: AiChatMessage) => AiChatMessage): void {
  updateMessages((messages) => {
    let index = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].streaming) {
        index = i;
        break;
      }
    }
    if (index < 0) return messages;
    const next = [...messages];
    next[index] = patch(next[index]);
    return next;
  });
}

/** IPC 事件监听是否已注册 */
let eventsBound = false;

async function bindEvents(): Promise<void> {
  if (eventsBound) return;
  eventsBound = true;
  await AiIPC.onChatDelta((payload) => {
    if (!activeSession || payload.sessionId !== activeSession.sessionId) return;
    patchStreamingAssistant((message) => ({
      ...message,
      content: message.content + payload.delta,
    }));
  });
  await AiIPC.onChatDone((payload) => {
    if (!activeSession || payload.sessionId !== activeSession.sessionId) return;
    activeSession = null;
    updateMessages(
      (messages) => {
        const next = messages.map((item) =>
          item.streaming ? { ...item, streaming: false, content: item.content } : item,
        );
        // 中止且无内容时移除空占位消息
        return payload.aborted
          ? next.filter((item) => !(item.role === "assistant" && item.content === ""))
          : next;
      },
      { persist: true },
    );
    publish({ ...snapshot, isGenerating: false });
  });
  await AiIPC.onChatError((payload: AiChatErrorPayload) => {
    if (!activeSession || payload.sessionId !== activeSession.sessionId) return;
    activeSession = null;
    const friendly = friendlyErrorMessage(payload.code, payload.message);
    updateMessages(
      (messages) =>
        messages.map((item) =>
          item.streaming ? { ...item, streaming: false, error: true, content: friendly } : item,
        ),
      { persist: true },
    );
    publish({ ...snapshot, isGenerating: false, lastError: friendly });
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
      publish({ ...snapshot, configured, cardEnabled });
    }
  },

  /**
   * 发送一条用户消息并开始流式生成。
   * 未配置 apiKey/baseUrl 时直接置错误提示（引导去设置）。
   */
  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || snapshot.isGenerating) return;

    const config = await UserConfigStore.get();
    const ai = config.ai;
    const baseUrl = ai?.baseUrl?.trim();
    const apiKey = ai?.apiKey?.trim();
    const model = ai?.model?.trim();
    if (!baseUrl || !apiKey) {
      publish({
        ...snapshot,
        lastError: LocaleService.translate("ai.errorNotConfigured"),
      });
      return;
    }
    if (!model) {
      publish({
        ...snapshot,
        lastError: LocaleService.translate("ai.errorModelMissing"),
      });
      return;
    }

    await bindEvents();

    const sessionId = createId();
    activeSession = { sessionId };

    const userMessage: AiChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
    };
    const assistantMessage: AiChatMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      streaming: true,
    };
    publish({
      ...snapshot,
      messages: [...snapshot.messages, userMessage, assistantMessage],
      isGenerating: true,
      lastError: null,
      configured: true,
    });

    // 组装上下文：最近 20 条非流式历史 + system 提示词
    const history = snapshot.messages
      .filter((item) => !item.streaming && item.content !== "")
      .slice(-CONTEXT_WINDOW)
      .map((item) => ({ role: item.role, content: item.content }));
    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];

    try {
      await AiIPC.send({ sessionId, baseUrl, apiKey, model, messages });
    } catch {
      // invoke 层失败（命令不可达等）：本地收尾并提示
      activeSession = null;
      const friendly = LocaleService.translate("ai.errorGeneric").replace(
        "{message}",
        LocaleService.translate("ai.errorUnavailable"),
      );
      updateMessages(
        (items) =>
          items.map((item) =>
            item.streaming ? { ...item, streaming: false, error: true, content: friendly } : item,
          ),
        { persist: true },
      );
      publish({ ...snapshot, isGenerating: false, lastError: friendly });
    }
  },

  /** 中止当前流式生成（IPC abort + 本地收尾） */
  async abort(): Promise<void> {
    if (!activeSession) return;
    const { sessionId } = activeSession;
    activeSession = null;
    updateMessages(
      (messages) =>
        messages
          .map((item) => (item.streaming ? { ...item, streaming: false } : item))
          .filter((item) => !(item.role === "assistant" && item.content === "")),
      { persist: true },
    );
    publish({ ...snapshot, isGenerating: false });
    try {
      await AiIPC.abort(sessionId);
    } catch {
      // 中止失败不影响本地状态（流可能已结束）
    }
  },

  /** 清空会话（生成中先中止） */
  async clear(): Promise<void> {
    if (activeSession) await AiChatService.abort();
    updateMessages(() => [], { persist: true });
    publish({ ...snapshot, lastError: null });
  },
};
