import type { ReactNode } from "react";
import { cn } from "../../Shared/Utils/cn";

export function SidebarPageHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between px-[var(--PanelPaddingX)] pb-2 pt-4",
        className,
      )}
    >
      <h2 className="flex min-w-0 items-center gap-2 truncate text-[14px] font-bold tracking-tight text-[var(--TextHighlight)]">
        {title}
      </h2>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </header>
  );
}
