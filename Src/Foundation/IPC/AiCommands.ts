import { invokeDesktop, listenDesktop } from "../Desktop";

export interface AiResponseUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type AiResponseErrorCode =
  | "connect"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "first_token_timeout"
  | "idle_timeout"
  | "generic";

export interface AiResponseEventPayload {
  requestId: string;
  type:
    | "response.created"
    | "response.output_text.delta"
    | "response.function_call_arguments.delta"
    | "response.output_item.done"
    | "response.completed"
    | "response.failed"
    | "error";
  responseId?: string;
  itemId?: string;
  outputIndex?: number;
  delta?: string;
  name?: string;
  argumentsDelta?: string;
  callId?: string;
  finishReason?: string;
  usage?: AiResponseUsage;
  code?: AiResponseErrorCode;
  message?: string;
  raw?: unknown;
}

export const AI_RESPONSES_EVENTS = {
  event: "ai://responses-event",
} as const;

export const AiIPC = {
  responsesSend: (payload: {
    requestId: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    instructions?: string;
    input: unknown[];
    tools?: Array<Record<string, unknown>>;
    previousResponseId?: string;
  }) => invokeDesktop<void>("ai_responses_send", payload),

  responsesAbort: (requestId: string) => invokeDesktop<void>("ai_responses_abort", { requestId }),

  onResponseEvent: (handler: (payload: AiResponseEventPayload) => void) =>
    listenDesktop<AiResponseEventPayload>(AI_RESPONSES_EVENTS.event, handler),

  testResponsesConnection: (payload: { baseUrl: string; apiKey: string; model: string }) =>
    invokeDesktop<number>("ai_test_responses_connection", payload),
};
