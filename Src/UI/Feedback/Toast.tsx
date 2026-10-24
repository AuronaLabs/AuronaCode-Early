import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import {
  showToast,
  type ToastAction,
  type ToastMessage,
  type ToastType,
} from "../../Foundation/Notifications";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { UserConfig } from "../../Foundation/Types/Config";
import { computeGlassAccent } from "../Core/GlassManager";
import { Icons } from "../Icons/IconManager";

/** 状态色收敛：四令牌（success/error/warning/info），confirm 复用 primary。 */
const STATUS_TINT: Record<ToastType, string> = {
  success: "var(--StatusSuccess)",
  error: "var(--StatusError)",
  warning: "var(--StatusWarning)",
  confirm: "var(--color-accent)",
  info: "var(--StatusInfo)",
};

const STATUS_TEXT_CLASS: Record<ToastType, string> = {
  success: "text-[var(--StatusSuccess)]",
  error: "text-[var(--StatusError)]",
  warning: "text-[var(--StatusWarning)]",
  confirm: "text-[var(--color-accent)]",
  info: "text-[var(--StatusInfo)]",
};

export function ToastContainer() {
  const { t } = useLocale();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const entries = useRef(new Map<string, ToastMessage>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingActions = useRef(new Set<string>());
  const pendingToasts = useRef(new Map<string, symbol>());

  const dismissToast = useCallback((id: string) => {
    pendingToasts.current.delete(id);
    const target = entries.current.get(id);
    entries.current.delete(id);
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts([...entries.current.values()]);
    target?.onDismiss?.();
  }, []);

  useEffect(() => {
    let active = true;
    const handleToast = async (payload: Omit<ToastMessage, "id"> & { id?: string }) => {
      const id = payload.id || Date.now().toString() + Math.random().toString();
      const revision = Symbol(id);
      pendingToasts.current.set(id, revision);
      const config = await UserConfigStore.get().catch(() => ({}) as UserConfig);
      if (!active || pendingToasts.current.get(id) !== revision) return;
      pendingToasts.current.delete(id);
      const isCritical =
        payload.type === "error" ||
        payload.type === "warning" ||
        Boolean(payload.actions && payload.actions.length > 0);

      // 若启用了静音非重要通知且当前通知非关键级别，则不弹出右下角 Toast
      if (config.muteNonCriticalToasts && !isCritical) {
        return;
      }

      const defaultDuration =
        payload.actions && payload.actions.length > 0 ? null : (config.toastDuration ?? 4000);
      const duration = payload.duration !== undefined ? payload.duration : defaultDuration;

      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      entries.current.set(id, { ...payload, id, duration });
      setToasts([...entries.current.values()]);

      if (duration && duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismissToast(id), duration),
        );
      }
    };

    const unsubscribe = EventBus.on("app:toast", (p) => void handleToast(p));
    const currentTimers = timers.current;
    return () => {
      active = false;
      unsubscribe();
      for (const timer of currentTimers.values()) clearTimeout(timer);
      currentTimers.clear();
    };
  }, [dismissToast]);

  useEffect(() => EventBus.on("app:dismiss-toast", dismissToast), [dismissToast]);

  const handleActionClick = async (toastId: string, action: ToastAction) => {
    if (pendingActions.current.has(toastId)) return;
    pendingActions.current.add(toastId);
    const target = entries.current.get(toastId);
    try {
      await action.onClick?.();
      if (entries.current.get(toastId) === target) dismissToast(toastId);
    } catch (error) {
      showToast(String(error), "error", { id: `${toastId}:action-error` });
    } finally {
      pendingActions.current.delete(toastId);
    }
  };

  return (
    <div className="fixed bottom-[calc(var(--StatusBarHeight)+16px)] right-6 z-[100] flex flex-col-reverse gap-3 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => {
        const hasTitle = Boolean(toast.title);
        const tint = STATUS_TINT[toast.type];
        return (
          <div
            key={toast.id}
            className={`glass-layer-overlay glass-accent-halo pointer-events-auto relative flex flex-col gap-2.5 overflow-hidden rounded-overlay border border-[var(--border-overlay)] bg-[var(--material-overlay)]/95 p-3.5 backdrop-blur-[var(--glass-blur-overlay)] shadow-2xl animate-in slide-in-from-bottom-5 slide-in-from-right-5 fade-in duration-300 ease-out transform transition-all group`}
            style={
              {
                // 状态色改为点缀：极弱底染 + 边缘勾色，右上角光斑交给 .glass-accent-halo
                ...computeGlassAccent(tint, tint),
                "--GlassAccent-Halo": tint,
              } as CSSProperties
            }
          >
            <div className={`flex ${hasTitle ? "items-start" : "items-center"} gap-3`}>
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-control ${STATUS_TEXT_CLASS[toast.type]}`}
                style={{ backgroundColor: `color-mix(in srgb, ${tint} 16%, transparent)` }}
              >
                {toast.type === "success" && <Icons.Checks size={16} stroke={2} />}
                {toast.type === "error" && <Icons.Close size={16} stroke={2} />}
                {toast.type === "warning" && <Icons.AlertTriangle size={16} stroke={2} />}
                {toast.type === "confirm" && <Icons.InfoCircle size={17} stroke={2} />}
                {toast.type === "info" && <Icons.Info size={16} stroke={2} />}
              </div>

              <div className="flex-1 min-w-0 pr-5">
                {hasTitle && (
                  <div className="text-[13.5px] font-semibold text-[var(--color-text-highlight)] leading-snug select-none mb-0.5">
                    {toast.title}
                  </div>
                )}
                <div
                  className={`${
                    hasTitle
                      ? "text-[12.5px] text-[var(--color-text-primary)]"
                      : "text-[13px] font-medium text-[var(--color-text-highlight)]"
                  } leading-relaxed select-none break-words [overflow-wrap:anywhere]`}
                >
                  {toast.message}
                </div>
              </div>

              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className={`absolute right-2.5 ${
                  hasTitle ? "top-2.5" : "top-1/2 -translate-y-1/2"
                } p-1 rounded-full opacity-60 hover:opacity-100 hover:bg-[var(--material-interactive-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] transition-all cursor-pointer`}
                aria-label={t("common.dismissNotification")}
              >
                <Icons.Close size={13} stroke={2} />
              </button>
            </div>

            {toast.actions && toast.actions.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-[var(--border-subtle)]/60 mt-1">
                {toast.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => void handleActionClick(toast.id, action)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all cursor-pointer select-none ${
                      action.primary || action.variant === "primary"
                        ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white shadow-sm"
                        : action.variant === "danger"
                          ? "bg-[var(--StatusError)]/15 text-[var(--StatusError)] hover:bg-[var(--StatusError)]/25"
                          : "bg-[var(--material-interactive-hover)] text-[var(--color-text-primary)] hover:bg-[var(--material-interactive-active)]"
                    }`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type {
  ShowToastOptions,
  ToastAction,
  ToastMessage,
  ToastType,
} from "../../Foundation/Notifications";
export {
  dismissNotification,
  showConfirm,
  showNotification,
  showToast,
} from "../../Foundation/Notifications";
