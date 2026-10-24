import { EventBus } from "./EventBus";
import { LocaleService } from "./I18n";

export type ToastType = "info" | "success" | "warning" | "error" | "confirm";

export interface ToastAction {
  label: string;
  primary?: boolean;
  variant?: "default" | "primary" | "danger" | "secondary";
  onClick?: () => void | Promise<void>;
}

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number | null;
  actions?: ToastAction[];
  onDismiss?: () => void;
}

export interface ShowToastOptions {
  id?: string;
  title?: string;
  duration?: number | null;
  actions?: ToastAction[];
  onDismiss?: () => void;
}

export const showToast = (
  message: string,
  type: ToastType = "info",
  options?: ShowToastOptions,
) => {
  EventBus.emit("app:toast", {
    message,
    type,
    ...options,
  });
};

export const showNotification = (options: {
  title?: string;
  message: string;
  type?: ToastType;
  id?: string;
  duration?: number | null;
  actions?: ToastAction[];
  onDismiss?: () => void;
}) => {
  EventBus.emit("app:toast", {
    type: options.type ?? "info",
    ...options,
  });
};

export const showConfirm = (options: {
  id?: string;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}): string => {
  const id = options.id ?? `confirm-${Date.now()}-${Math.random()}`;
  let settled = false;
  const settle = async (action?: () => void | Promise<void>) => {
    if (settled) return;
    settled = true;
    try {
      await action?.();
    } catch (error) {
      settled = false;
      throw error;
    }
  };
  showNotification({
    id,
    title: options.title,
    message: options.message,
    type: "confirm",
    duration: null,
    actions: [
      {
        label: options.cancelLabel ?? LocaleService.translate("common.cancel"),
        variant: "secondary",
        onClick: () => settle(options.onCancel),
      },
      {
        label: options.confirmLabel ?? LocaleService.translate("common.ok"),
        primary: true,
        onClick: () => settle(options.onConfirm),
      },
    ],
    onDismiss: () => void settle(options.onCancel),
  });
  return id;
};

export const dismissNotification = (id: string): void => {
  EventBus.emit("app:dismiss-toast", id);
};
