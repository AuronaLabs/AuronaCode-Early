import { invokeDesktop, listenDesktop } from "../Desktop";

/** 0.4.6 批次 5：AI 助手流式聊天事件与命令封装 */

/** Rust → 前端：会话开始 */
export interface AiChatStartPayload {
  sessionId: string;
}

/** Rust → 前端：增量文本 */
export interface AiChatDeltaPayload {
  sessionId: string;
  delta: string;
}

/** Rust → 前端：会话结束（正常完成或中止） */
export interface AiChatDonePayload {
  sessionId: string;
  /** 是否被用户中止 */
  aborted: boolean;
  /** 结束原因：stop / length / tool_calls / aborted 等 */
  finishReason: string;
}

/** 错误码：connect 连接失败 / auth 认证失败 / rate_limit 限流 / timeout 超时 / generic 其他 */
export type AiChatErrorCode = "connect" | "auth" | "rate_limit" | "timeout" | "generic";

/** Rust → 前端：会话错误 */
export interface AiChatErrorPayload {
  sessionId: string;
  code: AiChatErrorCode;
  message: string;
}

export const AI_CHAT_EVENTS = {
  start: "ai://chat-start",
  delta: "ai://chat-delta",
  done: "ai://chat-done",
  error: "ai://chat-error",
} as const;

export interface AiIpcMessage {
  role: string;
  content: string;
}

export const AiIPC = {
  /** 发起流式对话（结果通过 ai://chat-* 事件异步推回） */
  send: (payload: {
    sessionId: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: AiIpcMessage[];
  }) => invokeDesktop<void>("ai_chat_send", payload),

  /** 中止当前会话的流式输出 */
  abort: (sessionId: string) => invokeDesktop<void>("ai_chat_abort", { sessionId }),

  /** 订阅会话开始事件 */
  onChatStart: (handler: (payload: AiChatStartPayload) => void) =>
    listenDesktop<AiChatStartPayload>(AI_CHAT_EVENTS.start, handler),

  /** 订阅增量文本事件 */
  onChatDelta: (handler: (payload: AiChatDeltaPayload) => void) =>
    listenDesktop<AiChatDeltaPayload>(AI_CHAT_EVENTS.delta, handler),

  /** 订阅会话结束事件 */
  onChatDone: (handler: (payload: AiChatDonePayload) => void) =>
    listenDesktop<AiChatDonePayload>(AI_CHAT_EVENTS.done, handler),

  /** 订阅会话错误事件 */
  onChatError: (handler: (payload: AiChatErrorPayload) => void) =>
    listenDesktop<AiChatErrorPayload>(AI_CHAT_EVENTS.error, handler),
};
