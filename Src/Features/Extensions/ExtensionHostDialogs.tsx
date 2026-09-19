import { useEffect, useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import type { ExtensionHostRequestEvent } from "../../Foundation/IPC/ExtensionCommands";
import { ExtensionIPC } from "../../Foundation/IPC/ExtensionCommands";
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { Modal } from "../../UI/Components/Modal";

/**
 * 扩展宿主对话框桥（0.4.6）：消费 confirm / input / quick-pick 三类
 * 需要用户交互的宿主请求，以 Modal 呈现并回填应答。
 * 无交互类请求（剪贴板/命令/通知）由 ExtensionHostBridge（无头）处理。
 */

type PendingDialog = Extract<
  ExtensionHostRequestEvent,
  { kind: "confirm" | "input" | "quick-pick" }
>;

const respond = (requestId: string, value: Record<string, unknown>) =>
  void ExtensionIPC.hostResponse(requestId, JSON.stringify(value));

export function ExtensionHostDialogs() {
  const { t } = useLocale();
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void ExtensionIPC.onHostRequest((request) => {
      if (request.kind === "confirm" || request.kind === "input" || request.kind === "quick-pick") {
        setPending(request);
        if (request.kind === "input") setInputValue("");
      }
    }).then((unlistenFn) => {
      if (disposed) unlistenFn();
      else unlisten = unlistenFn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const close = () => setPending(null);

  if (!pending) return null;

  if (pending.kind === "confirm") {
    return (
      <Modal
        isOpen
        onClose={close}
        title={pending.title || t("common.confirm")}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                respond(pending.requestId, { confirmed: false });
                close();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                respond(pending.requestId, { confirmed: true });
                close();
              }}
            >
              {t("common.confirm")}
            </Button>
          </div>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
          {pending.message}
        </p>
      </Modal>
    );
  }

  if (pending.kind === "input") {
    return (
      <Modal
        isOpen
        onClose={() => {
          respond(pending.requestId, { cancelled: true });
          close();
        }}
        title={pending.title || t("common.input")}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                respond(pending.requestId, { cancelled: true });
                close();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                respond(pending.requestId, { value: inputValue });
                close();
              }}
            >
              {t("common.confirm")}
            </Button>
          </div>
        }
      >
        <Input
          autoFocus
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={pending.placeholder}
          fullWidth
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              respond(pending.requestId, { value: inputValue });
              close();
            }
          }}
        />
      </Modal>
    );
  }

  // quick-pick
  const items = pending.items ?? [];
  return (
    <Modal
      isOpen
      onClose={() => {
        respond(pending.requestId, { cancelled: true });
        close();
      }}
      title={pending.title || t("common.select")}
    >
      <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
        {items.length === 0 ? (
          <span className="py-4 text-center text-[12px] text-[var(--color-text-muted)]">—</span>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                respond(pending.requestId, { id: item.id });
                close();
              }}
              className="flex flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--material-interactive-hover)] cursor-pointer"
            >
              <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
                {item.label}
              </span>
              {item.detail && (
                <span className="text-[11px] text-[var(--color-text-muted)]">{item.detail}</span>
              )}
            </button>
          ))
        )}
      </div>
      {pending.placeholder && (
        <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">{pending.placeholder}</p>
      )}
    </Modal>
  );
}
