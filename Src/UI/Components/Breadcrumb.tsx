import * as React from "react";
import { cn } from "../../Shared/Utils/cn";

export interface BreadcrumbItem {
  label: React.ReactNode;
  href?: string;
  id?: string;
}

export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex min-w-0 items-center gap-1 text-[12px]", className)}
    >
      {items.map((item, index) => (
        <React.Fragment key={item.id ?? item.href ?? `${index}:${String(item.label)}`}>
          {index > 0 && <span className="text-[var(--color-text-muted)]">/</span>}
          {item.href ? (
            <a
              href={item.href}
              className="truncate text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)]"
            >
              {item.label}
            </a>
          ) : (
            <span className="truncate text-[var(--color-text-highlight)]">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
