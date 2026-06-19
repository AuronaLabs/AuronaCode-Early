import { Icons } from "../../UI/Icons/IconManager";

export function NotificationsPanel() {
  return (
    <div className="flex flex-col h-full w-full bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
        <h2 className="text-[14px] font-bold text-[var(--ColorTextHighlight)] tracking-tight">通知</h2>
        <div className="flex gap-1">
          <button className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] transition-colors">
            <Icons.Checks size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 items-center justify-center p-6 text-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-black/5 dark:bg-white/5 text-[var(--ColorMuted)]">
          <Icons.Bell size={32} stroke={1} />
        </div>
        <div className="space-y-1">
          <h3 className="text-[13px] font-semibold text-[var(--ColorTextHighlight)]">暂无新通知</h3>
          <p className="text-[11px] text-[var(--ColorMuted)] leading-relaxed">
            我们会在后台静默处理大部分任务
            <br />
            仅在必要时通知你
          </p>
        </div>
      </div>
    </div>
  );
}
