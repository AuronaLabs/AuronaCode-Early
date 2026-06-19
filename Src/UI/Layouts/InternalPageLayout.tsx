import { ReactNode } from "react";

interface InternalPageLayoutProps {
  children: ReactNode;
  title?: ReactNode;
  icon?: ReactNode;
  sidebar?: ReactNode;
}

export function InternalPageLayout({ children, title, icon, sidebar }: InternalPageLayoutProps) {
  return (
    <div className="flex h-full w-full bg-[var(--ColorEditor)] select-none text-[var(--ColorText)] overflow-hidden">
      {/* Sidebar Area */}
      {sidebar && (
        <div className="w-56 flex-shrink-0 border-r border-[var(--ColorPanelBorder)] bg-black/[0.02] dark:bg-white/[0.02] py-8 px-4 overflow-y-auto">
          {sidebar}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-8 overflow-y-auto">
        <div className="flex flex-col w-full max-w-4xl mx-auto">
          {/* Optional Header */}
          {(title || icon) && (
            <div className="flex items-center gap-3 mb-8 pb-4 border-b border-[var(--ColorPanelBorder)]">
              {icon && <div className="text-[var(--ColorTextHighlight)]">{icon}</div>}
              {title && (
                <h1 className="text-xl text-[var(--ColorTextHighlight)] font-semibold tracking-tight">
                  {title}
                </h1>
              )}
            </div>
          )}
          
          {/* Content Area */}
          <div className="flex flex-col flex-1 w-full gap-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
