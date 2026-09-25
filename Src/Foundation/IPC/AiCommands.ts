import { invokeDesktop, listenDesktop } from "../Desktop";

/** 0.4.6 批次 5：AI 助手流式聊天事件与命令封装 */
/** 0.4.7：tool_calls 协议预留（解析与透传，不执行）、usage 透传、超时码细分 */

/** Rust → 前端：会话开始 */
export interface AiChatStartPayload {
  sessionId: string;
}

/** 单条 tool_calls 增量（前端按 index 聚合，argumentsDelta 为增量片段） */
export interface AiChatToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsDelta?: string;
}

/** Rust → 前端：增量文本（仅 tool_calls 增量时 delta 为空串） */
export interface AiChatDeltaPayload {
  sessionId: string;
  delta: string;
  toolCalls?: AiChatToolCallDelta[];
}

/** token 用量统计（服务端在收尾分片携带时透传） */
export interface AiChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Rust → 前端：会话结束（正常完成或中止） */
export interface AiChatDonePayload {
  sessionId: string;
  /** 是否被用户中止 */
  aborted: boolean;
  /** 结束原因：stop / length / tool_calls / aborted 等 */
  finishReason: string;
  usage?: AiChatUsage;
}

/**
 * 错误码：connect 连接失败 / auth 认证失败 / rate_limit 限流 / timeout 总时长超限 /
 * first_token_timeout 首 token 超时 / idle_timeout 流式静默超时 / generic 其他
 */
export type AiChatErrorCode =
  | "connect"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "first_token_timeout"
  | "idle_timeout"
  | "generic";

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

/** OpenAI 兼容 tool_calls 字段（上行回传，arguments 为完整字符串） */
export interface AiIpcToolFunction {
  name: string;
  arguments: string;
}

export interface AiIpcToolCall {
  id: string;
  type: "function";
  function: AiIpcToolFunction;
}

export interface AiIpcToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * 聊天消息载荷。0.4.8 agent 化：assistant 消息可携带 toolCalls，
 * 工具结果以 role:"tool" + toolCallId 回传（content 缺省表示 null content）。
 */
export interface AiIpcMessage {
  role: string;
  content?: string;
  toolCalls?: AiIpcToolCall[];
  toolCallId?: string;
}

export const AiIPC = {
  /** Rust 侧测试 provider，避免浏览器 CORS 阻断本地桌面请求。 */
  testConnection: (payload: { baseUrl: string; apiKey: string }) =>
    invokeDesktop<number>("ai_test_connection", payload),
  /** 发起流式对话（结果通过 ai://chat-* 事件异步推回） */
  send: (payload: {
    sessionId: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: AiIpcMessage[];
    tools?: AiIpcToolDefinition[];
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
