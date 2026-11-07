import { CommandRegistry } from "../../Core/Commands/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
import {
  type ExtensionHostRequestEvent,
  ExtensionIPC,
} from "../../Foundation/IPC/ExtensionCommands";
import { DisposableScope } from "../../Foundation/Lifecycle/DisposableScope";
import { showToast } from "../../UI/Feedback/Toast";

interface BridgeSession {
  scope: DisposableScope;
  owners: number;
  ready: Promise<void>;
}
let current: BridgeSession | null = null;

/** Application-owned adapters for clipboard, commands and extension notifications. */
export async function startExtensionHostBridge(): Promise<() => void> {
  let session = current;
  if (!session) {
    const scope = new DisposableScope();
    session = { scope, owners: 0, ready: Promise.resolve() };
    current = session;
    const owner = session;
    const respond = (request: ExtensionHostRequestEvent, response: Record<string, unknown>) => {
      if (scope.isDisposed) return Promise.resolve();
      return ExtensionIPC.hostResponse(request, JSON.stringify(response)).catch(console.error);
    };
    const execute = async (request: ExtensionHostRequestEvent) => {
      if (scope.isDisposed) return;
      try {
        if (request.kind === "clipboard-write") {
          await navigator.clipboard.writeText(request.text ?? "");
          await respond(request, { ok: true });
        } else if (request.kind === "clipboard-read") {
          const value = await navigator.clipboard.readText();
          await respond(request, { ok: true, value });
        } else if (request.kind === "command") {
          const result = await CommandRegistry.execute(request.commandId ?? "", request.arguments);
          await respond(request, result.ok ? { ok: true } : { error: String(result.error) });
        }
      } catch (error) {
        await respond(request, { error: String(error) });
      }
    };
    session.ready = (async () => {
      const registrations = await Promise.allSettled([
        ExtensionIPC.onHostRequest((request) => {
          void execute(request);
        }),
        ExtensionIPC.onNotification(({ level, message }) => {
          if (scope.isDisposed) return;
          showToast(
            message,
            level === "error"
              ? "error"
              : level === "warn"
                ? "warning"
                : level === "success"
                  ? "success"
                  : "info",
          );
        }),
        ExtensionIPC.onStatusMessage((event) => {
          if (!scope.isDisposed) EventBus.emit("extension:status-message", event);
        }),
      ]);
      for (const result of registrations)
        if (result.status === "fulfilled") scope.add(result.value);
      const failure = registrations.find((result) => result.status === "rejected");
      if (failure) {
        if (current === owner) current = null;
        scope.dispose();
        throw failure.reason;
      }
    })();
  }
  const owner = session;
  owner.owners++;
  await owner.ready;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (--owner.owners === 0) {
      if (current === owner) current = null;
      owner.scope.dispose();
    }
  };
}
