import type { ReactNode } from "react";
import { cn } from "../../Shared/Utils/cn";
import { Badge } from "./Badge";

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
        "flex items-center justify-between px-3 py-2 text-[13px] font-medium transition-colors w-full rounded-[var(--radius-control)]",
        active
          ? "bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--color-text-highlight)] font-semibold"
          : "border border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)]",
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </div>
      {badge !== undefined && <Badge>{badge}</Badge>}
    </button>
  );
}
