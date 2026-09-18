import * as DialogPrimitive from "@radix-ui/react-dialog";
import type * as React from "react";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";
import { Icons } from "../Icons/IconManager";

export type ModalProps = {
  isOpen: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
};

export function Modal({ isOpen, onClose, title, children, footer, icon, className }: ModalProps) {
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[9998] bg-black/30 backdrop-blur-[var(--glass-blur-base)] animate-in fade-in duration-300" />
        <DialogPrimitive.Content
          className={cn(
            glassVariants({ layer: "overlay" }),
            "fixed left-[50%] top-[50%] z-[9999] flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border-[color-mix(in_srgb,var(--GlassSurface-Rim)_80%,var(--border-subtle))] shadow-[var(--GlassSurface-Shadow-Raised)] animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 ease-out focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50",
            className,
          )}
        >
          <div className="flex flex-col p-5 gap-3">
            {title && (
              <div className="flex items-center justify-between">
                <DialogPrimitive.Title className="text-[16px] font-semibold text-[var(--color-text-highlight)] flex items-center gap-2 m-0">
                  {icon}
                  {title}
                </DialogPrimitive.Title>
                {onClose && (
                  <DialogPrimitive.Close className="p-1 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50 cursor-pointer">
                    <Icons.Close size={16} stroke={2} />
                  </DialogPrimitive.Close>
                )}
              </div>
            )}
            <div className="text-[13.5px] text-[var(--color-text-primary)] leading-relaxed">
              {children}
            </div>
          </div>
          {footer && (
            <div className="bg-[var(--material-surface)] px-5 py-3 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)]">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
