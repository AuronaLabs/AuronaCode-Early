import { invokeDesktop, listenDesktop } from "../Desktop";
import type { AiProfile, AiProfileDraft, UserConfig } from "../Types/Config";

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
  | "empty_stream"
  | "incomplete_stream"
  | "invalid_stream"
  | "generic";

export interface AiResponseEventPayload {
  requestId: string;
  /** Known Responses events plus forward-compatible gateway events. */
  type: AiResponseEventType | (string & {});
  responseId?: string;
  itemId?: string;
  outputIndex?: number;
  delta?: string;
  text?: string;
  name?: string;
  argumentsDelta?: string;
  arguments?: string;
  callId?: string;
  finishReason?: string;
  incompleteReason?: string;
  usage?: AiResponseUsage;
  code?: AiResponseErrorCode;
  message?: string;
  raw?: unknown;
  /** Original event name and payload for events unknown to this client build. */
  rawEvent?: { type?: string; data?: unknown } | unknown;
}

export type AiResponseEventType =
  | "response.created"
  | "response.in_progress"
  | "response.output_text.delta"
  | "response.output_text.done"
  | "response.function_call_arguments.delta"
  | "response.function_call_arguments.done"
  | "response.output_item.added"
  | "response.output_item.done"
  | "response.completed"
  | "response.incomplete"
  | "response.failed"
  | "error";

export const AI_RESPONSES_EVENTS = {
  event: "ai://responses-event",
} as const;

export const AiIPC = {
  migrateUserConfig: () => invokeDesktop<UserConfig>("ai_profiles_migrate"),
  responsesSend: (payload: {
    requestId: string;
    profileId: string;
    instructions?: string;
    input: unknown[];
    tools?: Array<Record<string, unknown>>;
    previousResponseId?: string;
  }) => invokeDesktop<void>("ai_responses_send", payload),

  responsesAbort: (requestId: string) => invokeDesktop<void>("ai_responses_abort", { requestId }),

  onResponseEvent: (handler: (payload: AiResponseEventPayload) => void) =>
    listenDesktop<AiResponseEventPayload>(AI_RESPONSES_EVENTS.event, handler),

  saveProfile: async (profile: AiProfileDraft): Promise<AiProfile> => {
    const { apiKey, ...metadata } = profile;
    return invokeDesktop<AiProfile>("ai_profile_save", {
      profile: {
        ...metadata,
        credentialId: profile.id,
        hasCredential: profile.hasCredential ?? false,
        protocol: "responses",
      },
      apiKey: apiKey || null,
    });
  },

  deleteProfile: (profileId: string) => invokeDesktop<void>("ai_profile_delete", { profileId }),

  testResponsesConnection: (payload: { profileId: string; requestId: string }) =>
    invokeDesktop<number>("ai_test_responses_connection", payload),
};
