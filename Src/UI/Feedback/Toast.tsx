import { useEffect, useState } from "react";
import { EventBus } from "../../Foundation/EventBus";
import { Icons } from "../Icons/IconManager";

interface ToastMessage {
  id: string;
  type: "info" | "success" | "warning" | "error";
  message: string;
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handleToast = (payload: { type: ToastMessage["type"]; message: string }) => {
      const id = Date.now().toString() + Math.random().toString();
      setToasts((prev) => [...prev, { id, ...payload }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    };

    return EventBus.on("app:toast", handleToast);
  }, []);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="fixed bottom-[calc(var(--StatusBarHeight)+16px)] right-6 z-[100] flex flex-col-reverse gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto relative flex max-w-sm items-center gap-3 rounded-xl border border-[var(--border-overlay)] bg-[var(--material-overlay)] p-3 pr-8 shadow-[var(--shadow-overlay)] backdrop-blur-[var(--glass-blur-floating)] animate-in slide-in-from-bottom-5 slide-in-from-right-5 fade-in duration-300 ease-out transform transition-all group"
        >
          <div
            className={`flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${
              toast.type === "success"
                ? "bg-green-500/10 text-green-500"
                : toast.type === "error"
                  ? "bg-red-500/10 text-red-500"
                  : toast.type === "warning"
                    ? "bg-amber-500/10 text-amber-500"
                    : "bg-[color-mix(in_srgb,var(--AccentPrimary)_10%,transparent)] text-[var(--AccentPrimary)]"
            }`}
          >
            {toast.type === "success" && <Icons.Checks size={16} />}
            {toast.type === "error" && <Icons.Close size={16} />}
            {toast.type === "warning" && <Icons.AlertTriangle size={16} />}
            {toast.type === "info" && <Icons.Info size={16} />}
          </div>
          <span className="text-[13px] text-[var(--TextHighlight)] font-medium select-none break-all leading-normal">
            {toast.message}
          </span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] transition-all cursor-pointer"
          >
            <Icons.Close size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export const showToast = (message: string, type: ToastMessage["type"] = "info") => {
  EventBus.emit("app:toast", { message, type });
};
