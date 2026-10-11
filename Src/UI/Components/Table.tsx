import type * as React from "react";
import { cn } from "../../Shared/Utils/cn";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-surface border border-[var(--border-subtle)]">
      <table {...props} className={cn("w-full border-collapse text-left text-[12px]", className)} />
    </div>
  );
}

export function TableHeader(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} className={cn("bg-[var(--surface-base)]", props.className)} />;
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody {...props} className={cn("divide-y divide-[var(--border-subtle)]", props.className)} />
  );
}

export function TableRow(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      {...props}
      className={cn("hover:bg-[var(--material-interactive-hover)]", props.className)}
    />
  );
}

export function TableCell(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} className={cn("px-3 py-2", props.className)} />;
}

export function TableHead(props: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className={cn("px-3 py-2 font-semibold text-[var(--color-text-muted)]", props.className)}
    />
  );
}
