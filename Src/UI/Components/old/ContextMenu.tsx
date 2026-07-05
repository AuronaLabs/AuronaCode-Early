import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    
    const handleScroll = () => {
      onClose();
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  
  const left = Math.min(x, window.innerWidth - 170);
  const top = Math.min(y, window.innerHeight - 110);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed bg-[var(--GlassSurface)] backdrop-blur-2xl border border-[var(--GlassBorder)] shadow-2xl rounded-xl p-1 z-[9999] flex flex-col min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
      style={{ top, left }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface ContextMenuItemProps {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
}

export function ContextMenuItem({
  icon,
  label,
  onClick,
  variant = "default",
  disabled,
}: ContextMenuItemProps) {
  const isDanger = variant === "danger";
  return (
    <button
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors text-left w-full outline-none ${
        disabled
          ? "opacity-50 cursor-not-allowed text-[var(--TextMuted)]"
          : isDanger
            ? "text-red-500 hover:bg-red-500/10"
            : "text-[var(--TextHighlight)] hover:bg-black/5 dark:hover:bg-white/10"
      }`}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
      {label}
    </button>
  );
}

export function ContextMenuDivider() {
  return <div className="h-px bg-[var(--GlassBorder)] my-0.5 mx-1" />;
}
