import { useEffect, useState } from "react";
import { EventBus } from "../../Core/EventBus";
import { Icons } from "../Icons/IconManager";

interface ToastMessage {
  id: string;
  type: "info" | "success" | "warning" | "error";
  message: string;
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handleToast = (payload: { type: ToastMessage["type"], message: string }) => {
      const id = Date.now().toString() + Math.random().toString();
      setToasts(prev => [...prev, { id, ...payload }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
    };

    return EventBus.on("app:toast", handleToast);
  }, []);

  return (
    <div className="fixed top-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto flex items-center gap-3 bg-[var(--ColorEditor)] border border-[var(--ColorPanelBorder)] shadow-xl rounded-xl p-3 pr-4 animate-in slide-in-from-right-8 fade-in duration-300">
          <div className={`flex items-center justify-center h-8 w-8 rounded-full ${
            toast.type === "success" ? "bg-green-500/10 text-green-500" :
            toast.type === "error" ? "bg-red-500/10 text-red-500" :
            toast.type === "warning" ? "bg-yellow-500/10 text-yellow-500" :
            "bg-blue-500/10 text-blue-500"
          }`}>
            {toast.type === "success" && <Icons.Checks size={16} />}
            {toast.type === "error" && <Icons.Close size={16} />}
            {toast.type === "warning" && <Icons.AlertTriangle size={16} />}
            {toast.type === "info" && <Icons.Info size={16} />}
          </div>
          <span className="text-[13px] text-[var(--ColorTextHighlight)] font-medium">
            {toast.message}
          </span>
        </div>
      ))}
    </div>
  );
}

export const showToast = (message: string, type: ToastMessage["type"] = "info") => {
  EventBus.emit("app:toast", { message, type });
};
