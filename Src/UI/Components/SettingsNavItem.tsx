import type { ReactNode } from "react";
import { cn } from "../../Shared/Utils/cn";

export interface SettingsNavItemProps {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}

export function SettingsNavItem({ label, icon, active, onClick }: SettingsNavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all",
        active
          ? "bg-[var(--material-surface)] backdrop-blur-[var(--glass-blur-elevated)] border border-[var(--border-subtle)] text-[var(--color-text-highlight)] font-semibold shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]"
          : "border border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
