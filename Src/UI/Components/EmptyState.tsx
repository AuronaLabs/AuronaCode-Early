import type { ReactNode } from "react";
import { cn } from "../../Shared/Utils/cn";

interface EmptyStateProps {
  /** 面板主题图标，建议传 Icons.xxx 且指定 size/stroke */
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  /** 底部胶囊状态条文案（带 accent 圆点） */
  badge?: ReactNode;
  /** badge 旁的额外动作（如重试按钮） */
  actions?: ReactNode;
  className?: string;
}

/**
 * 统一空状态：圆形发光图标 + 标题描述 + 胶囊状态条。
 * 与 Debug 面板空态同构，所有面板的无数据视图都应复用此组件。
 */
export function EmptyState({
  icon,
  title,
  description,
  badge,
  actions,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-5 overflow-hidden px-6 py-10 text-center",
        className,
      )}
    >
      <div className="pointer-events-none absolute h-44 w-44 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] blur-3xl" />
      <div className="relative">
        <div className="absolute inset-0 scale-125 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] blur-xl" />
        <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_22%,var(--border-subtle))] bg-[var(--material-surface)] text-[var(--color-accent)]">
          {icon}
        </div>
      </div>
      <div className="relative z-10 space-y-2">
        <h3 className="text-[14px] font-semibold text-[var(--color-text-highlight)]">{title}</h3>
        {description && (
          <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            {description}
          </p>
        )}
      </div>
      {(badge !== undefined || actions) && (
        <div className="relative z-10 flex items-center gap-2">
          {badge !== undefined && (
            <div className="flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_16%,var(--border-subtle))] bg-[var(--material-panel)] px-3 py-1 text-[11px] font-medium text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              {badge}
            </div>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
