import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { redactDiagnostic } from "../Security/Redaction";

export const desktopAvailable = () => isTauri();

export interface DesktopErrorShape {
  domain: string;
  code: string;
  message: string;
  recoverable: boolean;
  cause?: string;
}

export class DesktopError extends Error implements DesktopErrorShape {
  readonly domain: string;
  readonly code: string;
  readonly recoverable: boolean;
  readonly cause?: string;

  constructor(input: DesktopErrorShape) {
    super(redactDiagnostic(input.message));
    this.name = "DesktopError";
    this.domain = input.domain;
    this.code = input.code;
    this.recoverable = input.recoverable;
    this.cause = input.cause === undefined ? undefined : redactDiagnostic(input.cause);
  }
}

const domainFromName = (name: string) => name.split(/[.:/_-]/, 1)[0] || "desktop";

export function normalizeDesktopError(
  command: string,
  cause: unknown,
  overrides: Partial<DesktopErrorShape> = {},
): DesktopError {
  if (cause instanceof DesktopError) return cause;
  if (
    cause &&
    typeof cause === "object" &&
    "domain" in cause &&
    "code" in cause &&
    "message" in cause &&
    "recoverable" in cause
  ) {
    return new DesktopError(cause as DesktopErrorShape);
  }
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    "userMessage" in cause &&
    "detail" in cause &&
    "recoverable" in cause
  ) {
    const accountError = cause as {
      code: string;
      userMessage: string;
      detail: string;
      recoverable: boolean;
    };
    return new DesktopError({
      domain: overrides.domain ?? domainFromName(command),
      code: accountError.code,
      message: accountError.userMessage,
      recoverable: accountError.recoverable,
      cause: accountError.detail,
    });
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  const tagged = /^\[([a-z][a-z0-9_.-]*)\]\s*/i.exec(message);
  return new DesktopError({
    domain: overrides.domain ?? (tagged ? domainFromName(tagged[1]) : domainFromName(command)),
    code: overrides.code ?? tagged?.[1] ?? "COMMAND_FAILED",
    message: overrides.message ?? message,
    recoverable: overrides.recoverable ?? true,
    cause: overrides.cause ?? message,
  });
}

export async function invokeDesktop<Response = void>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<Response> {
  try {
    return await invoke<Response>(command, payload);
  } catch (cause) {
    throw normalizeDesktopError(command, cause);
  }
}

export async function listenDesktop<Payload>(
  event: string,
  handler: (payload: Payload) => void,
): Promise<UnlistenFn> {
  try {
    return await listen<Payload>(event, ({ payload }) => handler(payload));
  } catch (cause) {
    throw normalizeDesktopError(event, cause, { code: "EVENT_SUBSCRIBE_FAILED" });
  }
}
