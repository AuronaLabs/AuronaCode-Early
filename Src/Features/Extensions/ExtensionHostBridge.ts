import { CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
import type { ExtensionHostRequestEvent } from "../../Foundation/IPC/ExtensionCommands";
import { ExtensionIPC } from "../../Foundation/IPC/ExtensionCommands";
import { showToast } from "../../UI/Feedback/Toast";

/**
 * 扩展宿主桥（无头部分，0.4.6）：消费后端 host 函数发出的请求与事件。
 *
 * - clipboard-write / clipboard-read：webview 持有系统能力，应答即回
 * - command：路由到 CommandRegistry 执行
 * - notification：转前端 toast
 * - status-message：转 EventBus → StatusBar 临时消息
 *
 * 对话框类请求（confirm/input/quick-pick）由 ExtensionHostDialogs 组件消费。
 */

const respondOk = (request: ExtensionHostRequestEvent, extra: Record<string, unknown> = {}) =>
  ExtensionIPC.hostResponse(request, JSON.stringify({ ok: true, ...extra }));

const respondError = (request: ExtensionHostRequestEvent, error: string) =>
  ExtensionIPC.hostResponse(request, JSON.stringify({ error }));

let started = false;
let unlisteners: (() => void)[] = [];

export async function startExtensionHostBridge(): Promise<() => void> {
  if (started) {
    return () => undefined;
  }
  started = true;

  const [hostRequest, notification, statusMessage] = await Promise.all([
    ExtensionIPC.onHostRequest((request) => {
      switch (request.kind) {
        case "clipboard-write":
          navigator.clipboard
            .writeText(request.text ?? "")
            .then(() => respondOk(request))
            .catch((error: unknown) =>
              respondError(request, error instanceof Error ? error.message : String(error)),
            );
          break;
        case "clipboard-read":
          navigator.clipboard
            .readText()
            .then((value) => respondOk(request, { value }))
            .catch((error: unknown) =>
              respondError(request, error instanceof Error ? error.message : String(error)),
            );
          break;
        case "command": {
          const commandId = request.commandId ?? "";
          CommandRegistry.execute(commandId, request.arguments)
            .then((result) => {
              if (result.ok) {
                void respondOk(request);
              } else {
                void respondError(
                  request,
                  result.error instanceof Error ? result.error.message : String(result.error),
                );
              }
            })
            .catch((error: unknown) =>
              respondError(request, error instanceof Error ? error.message : String(error)),
            );
          break;
        }
        default:
          // confirm / input / quick-pick 由 ExtensionHostDialogs 处理
          break;
      }
    }),
    ExtensionIPC.onNotification(({ level, message }) => {
      const type =
        level === "error"
          ? "error"
          : level === "warn"
            ? "warning"
            : level === "success"
              ? "success"
              : "info";
      showToast(message, type);
    }),
    ExtensionIPC.onStatusMessage(({ message }) => {
      EventBus.emit("extension:status-message", { message });
    }),
  ]);

  unlisteners = [hostRequest, notification, statusMessage];
  return () => {
    unlisteners.forEach((unlisten) => {
      unlisten();
    });
    unlisteners = [];
    started = false;
  };
}
