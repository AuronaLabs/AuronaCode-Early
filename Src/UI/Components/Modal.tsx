import type * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Icons } from "../Icons/IconManager";

export type ModalProps = {
  isOpen: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  icon?: React.ReactNode;
};

export function Modal({ isOpen, onClose, title, children, footer, icon }: ModalProps) {
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[9998] bg-black/30 backdrop-blur-sm animate-in fade-in duration-300" />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-[9999] w-full max-w-md translate-x-[-50%] translate-y-[-50%] frosted-glass rounded-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 ease-out outline-none">
          <div className="flex flex-col p-5 gap-3">
            {title && (
              <div className="flex items-center justify-between">
                <DialogPrimitive.Title className="text-[16px] font-semibold text-[var(--TextHighlight)] flex items-center gap-2 m-0">
                  {icon}
                  {title}
                </DialogPrimitive.Title>
                {onClose && (
                  <DialogPrimitive.Close className="p-1 rounded-md text-[var(--TextMuted)] hover:bg-black/5 dark:hover:bg-white/10 hover:text-[var(--TextHighlight)] transition-colors outline-none cursor-pointer">
                    <Icons.Close size={16} stroke={2} />
                  </DialogPrimitive.Close>
                )}
              </div>
            )}
            <div className="text-[13.5px] text-[var(--TextPrimary)] leading-relaxed">
              {children}
            </div>
          </div>
          {footer && (
            <div className="bg-black/5 dark:bg-white/5 px-5 py-3 flex items-center justify-end gap-2 border-t border-[var(--GlassBorder)]">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
