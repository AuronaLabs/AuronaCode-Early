import type { ReactNode } from "react";
import { cn } from "../../Shared/Utils/cn";

export interface SettingsNavItemProps {
  label: string;
  icon: ReactNode;
  active: boolean;
  badge?: number | string;
  onClick: () => void;
}

export function SettingsNavItem({ label, icon, active, badge, onClick }: SettingsNavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center justify-between px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all w-full",
        active
          ? "bg-[var(--material-surface)] backdrop-blur-[var(--glass-blur-elevated)] border border-[var(--border-subtle)] text-[var(--color-text-highlight)] font-semibold"
          : "border border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)]",
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </div>
      {badge !== undefined && (
        <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--color-accent)]">
          {badge}
        </span>
      )}
    </button>
  );
}
