import { cn } from "../../Shared/Utils/cn";

export function Progress({
  value = 0,
  label,
  className,
}: {
  value?: number;
  label?: string;
  className?: string;
}) {
  const bounded = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--border-subtle)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bounded}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width]"
          style={{ width: `${bounded}%` }}
        />
      </div>
      {label && (
        <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">{label}</span>
      )}
    </div>
  );
}
