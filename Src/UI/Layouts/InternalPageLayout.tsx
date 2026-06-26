import { ReactNode } from "react";

interface InternalPageLayoutProps {
  children: ReactNode;
  title?: ReactNode;
  icon?: ReactNode;
  sidebar?: ReactNode;
  headerRight?: ReactNode;
  titleRight?: ReactNode;
}

export function InternalPageLayout({ children, title, icon, sidebar, headerRight, titleRight }: InternalPageLayoutProps) {
  return (
    <div className="flex h-full w-full bg-transparent select-none text-[var(--ColorText)] overflow-hidden">
      {/* 极简无边框悬浮侧边栏 */}
      {sidebar && (
        <div className="w-64 flex-shrink-0 bg-transparent py-10 px-6 overflow-y-auto">
          {sidebar}
        </div>
      )}

      {/* 主内容区裸背渲染 */}
      <div className="flex-1 flex flex-col p-10 overflow-y-auto aurona-scroll relative">
        <div className="flex flex-col w-full max-w-3xl mx-auto z-10 relative">
          {/* Optional Header */}
          {/* Optional Header */}
          {(title || icon || headerRight || titleRight) && (
            <div className="flex items-center justify-between mb-8 w-full gap-4 shrink-0">
              <div className="flex items-baseline gap-4">
                <div className="flex items-center gap-3">
                  {icon && <div className="text-[var(--ColorTextHighlight)]">{icon}</div>}
                  {title && (
                    <h1 className="text-2xl text-[var(--ColorTextHighlight)] font-bold tracking-tight text-shadow-sm whitespace-nowrap">
                      {title}
                    </h1>
                  )}
                </div>
                {titleRight && (
                  <div className="flex items-center shrink-0">
                    {titleRight}
                  </div>
                )}
              </div>
              {headerRight && (
                <div className="flex items-center shrink-0">
                  {headerRight}
                </div>
              )}
            </div>
          )}
          
          {/* Content Area */}
          <div className="flex flex-col flex-1 w-full gap-10">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
