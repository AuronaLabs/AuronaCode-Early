import type { ReactNode } from "react";

interface InternalPageLayoutProps {
  children: ReactNode;
  title?: ReactNode;
  icon?: ReactNode;
  sidebar?: ReactNode;
  headerRight?: ReactNode;
  titleRight?: ReactNode;
  maxWidth?: string;
}

export function InternalPageLayout({
  children,
  title,
  icon,
  sidebar,
  headerRight,
  titleRight,
  maxWidth,
}: InternalPageLayoutProps) {
  return (
    <div className="flex h-full w-full bg-transparent select-none text-[var(--TextPrimary)] overflow-hidden">
      {}
      {sidebar && (
        <div className="w-64 flex-shrink-0 bg-transparent px-6 pb-10 pt-10 overflow-y-auto">
          {sidebar}
        </div>
      )}

      {}
      <div className="flex-1 flex flex-col px-10 pb-10 pt-10 overflow-y-auto aurona-scroll relative">
        <div className={`flex flex-col w-full ${maxWidth || "max-w-3xl"} mx-auto z-10 relative`}>
          {}
          {}
          {(title || icon || headerRight || titleRight) && (
            <div className="flex items-center justify-between mb-8 w-full gap-4 shrink-0">
              <div className="flex items-baseline gap-4">
                <div className="flex items-center gap-3">
                  {icon && <div className="text-[var(--TextHighlight)]">{icon}</div>}
                  {title && (
                    <h1 className="text-2xl text-[var(--TextHighlight)] font-bold tracking-tight text-shadow-sm whitespace-nowrap">
                      {title}
                    </h1>
                  )}
                </div>
                {titleRight && <div className="flex items-center shrink-0">{titleRight}</div>}
              </div>
              {headerRight && <div className="flex items-center shrink-0">{headerRight}</div>}
            </div>
          )}

          {}
          <div className="flex flex-col flex-1 w-full gap-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
