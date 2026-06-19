import { ReactNode } from "react";
import { Icons } from "../Icons/IconManager";

export type ModalProps = {
  isOpen: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
};

export function Modal({ isOpen, onClose, title, children, footer, icon }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div 
        className="bg-[var(--ColorApp)] border border-[var(--ColorPanelBorder)] shadow-2xl rounded-xl w-full max-w-sm flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col p-5 gap-3">
          {title && (
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-[var(--ColorTextHighlight)] flex items-center gap-2">
                {icon}
                {title}
              </h3>
              {onClose && (
                <button 
                  onClick={onClose}
                  className="p-1 rounded-md text-[var(--ColorMuted)] hover:bg-black/5 dark:hover:bg-white/10 hover:text-[var(--ColorTextHighlight)] transition-colors"
                >
                  <Icons.Close size={16} stroke={2} />
                </button>
              )}
            </div>
          )}
          
          <div className="text-[13.5px] text-[var(--ColorText)] leading-relaxed">
            {children}
          </div>
        </div>

        {footer && (
          <div className="bg-black/5 dark:bg-white/5 px-5 py-3 flex items-center justify-end gap-2 border-t border-[var(--ColorPanelBorder)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
