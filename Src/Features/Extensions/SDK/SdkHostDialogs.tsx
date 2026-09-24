import { useEffect, useState } from "react";
import { useLocale } from "../../../Foundation/I18n";
import { Button } from "../../../UI/Components/Button";
import { Input } from "../../../UI/Components/Input";
import { Modal } from "../../../UI/Components/Modal";

/**
 * SDK 宿主对话框桥（0.4.7）：承载 AuronaSDKHost 的 showQuickPick / showInputBox
 * 真实交互。扩展侧经 showSdkQuickPick / showSdkInputBox 入队请求并挂起 Promise，
 * 本组件消费队列头部，以 Modal 呈现并回填结果；Esc 关闭按取消处理（返回 undefined）。
 * 挂载点与 ExtensionHostDialogs 一致（Layout/Workspace.tsx）。
 */

export interface SdkQuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
}

export interface SdkQuickPickOptions {
  title?: string;
  placeholder?: string;
}

export interface SdkInputBoxOptions {
  title?: string;
  placeholder?: string;
  value?: string;
  prompt?: string;
  password?: boolean;
}

type SdkDialogRequest =
  | {
      id: number;
      kind: "quick-pick";
      extensionId: string;
      items: SdkQuickPickItem[];
      options?: SdkQuickPickOptions;
      resolve: (value: SdkQuickPickItem | undefined) => void;
    }
  | {
      id: number;
      kind: "input";
      extensionId: string;
      options?: SdkInputBoxOptions;
      resolve: (value: string | undefined) => void;
    };

const requestQueue: SdkDialogRequest[] = [];
const queueListeners = new Set<() => void>();
let requestSequence = 0;

const notifyQueue = () => {
  for (const listener of queueListeners) listener();
};

export function showSdkQuickPick(
  extensionId: string,
  items: SdkQuickPickItem[],
  options?: SdkQuickPickOptions,
): Promise<SdkQuickPickItem | undefined> {
  return new Promise((resolve) => {
    requestQueue.push({
      id: ++requestSequence,
      kind: "quick-pick",
      extensionId,
      items,
      options,
      resolve,
    });
    notifyQueue();
  });
}

export function showSdkInputBox(
  extensionId: string,
  options?: SdkInputBoxOptions,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    requestQueue.push({
      id: ++requestSequence,
      kind: "input",
      extensionId,
      options,
      resolve,
    });
    notifyQueue();
  });
}

export function SdkHostDialogs() {
  const { t } = useLocale();
  const [queue, setQueue] = useState<SdkDialogRequest[]>(() => [...requestQueue]);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    const sync = () => setQueue([...requestQueue]);
    queueListeners.add(sync);
    return () => {
      queueListeners.delete(sync);
    };
  }, []);

  const active = queue[0];

  useEffect(() => {
    if (active?.kind === "input") setInputValue(active.options?.value ?? "");
  }, [active]);

  const settle = (request: SdkDialogRequest, value: unknown) => {
    const index = requestQueue.indexOf(request);
    if (index >= 0) requestQueue.splice(index, 1);
    (request.resolve as (value: unknown) => void)(value);
    notifyQueue();
  };

  if (!active) return null;

  const sourceLabel = t("extensions.sdkDialog.source").replace("{extension}", active.extensionId);

  if (active.kind === "input") {
    return (
      <Modal
        isOpen
        onClose={() => settle(active, undefined)}
        title={active.options?.title || t("common.input")}
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => settle(active, undefined)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => settle(active, inputValue)}>
              {t("common.confirm")}
            </Button>
          </div>
        }
      >
        <Input
          autoFocus
          type={active.options?.password ? "password" : "text"}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={active.options?.placeholder}
          fullWidth
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              settle(active, inputValue);
            }
          }}
        />
        {active.options?.prompt && (
          <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">{active.options.prompt}</p>
        )}
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">{sourceLabel}</p>
      </Modal>
    );
  }

  const items = active.items;
  return (
    <Modal
      isOpen
      onClose={() => settle(active, undefined)}
      title={active.options?.title || t("common.select")}
    >
      <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
        {items.length === 0 ? (
          <span className="py-4 text-center text-[12px] text-[var(--color-text-muted)]">—</span>
        ) : (
          items.map((item) => (
            <button
              key={`${item.label}:${item.description ?? ""}:${item.detail ?? ""}`}
              type="button"
              onClick={() => settle(active, item)}
              className="flex flex-col gap-0.5 rounded-control px-3 py-2 text-left transition-colors hover:bg-[var(--material-interactive-hover)] cursor-pointer"
            >
              <span className="flex items-baseline gap-2">
                <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  {item.label}
                </span>
                {item.description && (
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {item.description}
                  </span>
                )}
              </span>
              {item.detail && (
                <span className="text-[11px] text-[var(--color-text-muted)]">{item.detail}</span>
              )}
            </button>
          ))
        )}
      </div>
      {active.options?.placeholder && (
        <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">
          {active.options.placeholder}
        </p>
      )}
      <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">{sourceLabel}</p>
    </Modal>
  );
}
