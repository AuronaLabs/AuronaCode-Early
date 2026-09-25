import type { ReactNode } from "react";
import "./InternalPageLayout.css";

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
    <div className="internal-page-frame h-full w-full">
      <div className="internal-page-layout flex h-full w-full bg-transparent select-none text-[var(--color-text-primary)] overflow-hidden">
        {sidebar && (
          <div className="internal-page-sidebar w-64 flex-shrink-0 bg-transparent px-6 pb-10 pt-10 overflow-y-auto">
            {sidebar}
          </div>
        )}

        <div className="internal-page-content min-w-0 flex-1 flex flex-col px-10 pb-10 pt-10 overflow-y-auto aurona-scroll [scrollbar-gutter:stable] relative">
          <div className={`flex flex-col w-full ${maxWidth || "max-w-3xl"} mx-auto z-10 relative`}>
            {(title || icon || headerRight || titleRight) && (
              <div className="internal-page-header flex items-center justify-between mb-8 w-full gap-4 shrink-0">
                <div className="internal-page-header-main flex min-w-0 items-baseline gap-4">
                  <div className="flex items-center gap-3">
                    {icon && <div className="text-[var(--color-text-highlight)]">{icon}</div>}
                    {title && (
                      <h1 className="internal-page-heading min-w-0 text-2xl text-[var(--color-text-highlight)] font-bold">
                        {title}
                      </h1>
                    )}
                  </div>
                  {titleRight && <div className="flex min-w-0 items-center">{titleRight}</div>}
                </div>
                {headerRight && (
                  <div className="internal-page-header-right flex min-w-0 items-center">
                    {headerRight}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col flex-1 w-full gap-10">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
