import {
  cloneElement,
  type HTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  placement?: TooltipPlacement;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function computeTooltipPosition(
  anchor: DOMRect,
  requested: TooltipPlacement,
  width: number,
  height: number,
): { left: number; top: number; placement: TooltipPlacement } {
  const gap = 8;
  const margin = 8;
  let placement = requested;

  const fitsTop = anchor.top - gap - height >= margin;
  const fitsBottom = anchor.bottom + gap + height <= window.innerHeight - margin;
  const fitsLeft = anchor.left - gap - width >= margin;
  const fitsRight = anchor.right + gap + width <= window.innerWidth - margin;

  if (placement === "top" && !fitsTop && fitsBottom) placement = "bottom";
  else if (placement === "bottom" && !fitsBottom && fitsTop) placement = "top";
  else if (placement === "left" && !fitsLeft && fitsRight) placement = "right";
  else if (placement === "right" && !fitsRight && fitsLeft) placement = "left";

  let left = 0;
  let top = 0;
  if (placement === "top" || placement === "bottom") {
    const centerX = anchor.left + anchor.width / 2;
    left = clamp(centerX - width / 2, margin, Math.max(margin, window.innerWidth - margin - width));
    top = placement === "top" ? anchor.top - gap - height : anchor.bottom + gap;
  } else {
    const centerY = anchor.top + anchor.height / 2;
    top = clamp(
      centerY - height / 2,
      margin,
      Math.max(margin, window.innerHeight - margin - height),
    );
    left = placement === "left" ? anchor.left - gap - width : anchor.right + gap;
  }
  return { left, top, placement };
}

export function Tooltip({ content, children, delay = 300, placement = "top" }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, placement });
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setIsVisible(false);
  }, []);

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      const anchor = containerRef.current;
      if (!anchor) return;
      const width = tooltipRef.current?.offsetWidth ?? 160;
      const height = tooltipRef.current?.offsetHeight ?? 40;
      setPosition(computeTooltipPosition(anchor.getBoundingClientRect(), placement, width, height));
      setIsVisible(true);
    }, delay);
  }, [delay, placement]);

  // 首次渲染后按真实尺寸重新校正位置；右侧空间不足时自动向左借位并夹紧在窗口内。
  useLayoutEffect(() => {
    if (!isVisible) return;
    const anchor = containerRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    setPosition(
      computeTooltipPosition(
        anchor.getBoundingClientRect(),
        placement,
        tooltip.offsetWidth,
        tooltip.offsetHeight,
      ),
    );
  }, [isVisible, placement]);

  useEffect(() => {
    const handleGlobalHide = () => hide();
    window.addEventListener("blur", handleGlobalHide);
    window.addEventListener("resize", handleGlobalHide);
    window.addEventListener("pagehide", handleGlobalHide);
    window.addEventListener("scroll", handleGlobalHide, true);
    document.addEventListener("visibilitychange", handleGlobalHide);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.removeEventListener("blur", handleGlobalHide);
      window.removeEventListener("resize", handleGlobalHide);
      window.removeEventListener("pagehide", handleGlobalHide);
      window.removeEventListener("scroll", handleGlobalHide, true);
      document.removeEventListener("visibilitychange", handleGlobalHide);
    };
  }, [hide]);

  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<HTMLAttributes<HTMLElement>>, {
        onMouseEnter: (event) => {
          (children.props as HTMLAttributes<HTMLElement>).onMouseEnter?.(event);
          show();
        },
        onMouseLeave: (event) => {
          (children.props as HTMLAttributes<HTMLElement>).onMouseLeave?.(event);
          hide();
        },
        onMouseDown: (event) => {
          (children.props as HTMLAttributes<HTMLElement>).onMouseDown?.(event);
          // 点击触发元素（例如最小化按钮）时立即收起，避免窗口恢复后残留 tooltip。
          hide();
        },
        onFocus: (event) => {
          (children.props as HTMLAttributes<HTMLElement>).onFocus?.(event);
          show();
        },
        onBlur: (event) => {
          (children.props as HTMLAttributes<HTMLElement>).onBlur?.(event);
          hide();
        },
      })
    : children;

  return (
    <>
      <span ref={containerRef} className="inline-flex items-center justify-center">
        {trigger}
      </span>
      {isVisible &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            data-placement={position.placement}
            className={cn(
              glassVariants({ layer: "overlay" }),
              "fixed z-[9999] pointer-events-none max-w-72 rounded-lg px-2.5 py-1.5 text-[12px] font-medium leading-snug text-[var(--color-text-highlight)] shadow-[var(--shadow-surface),var(--GlassSurface-Shadow-Base)] animate-in fade-in zoom-in-95 duration-150",
            )}
            style={{ left: position.left, top: position.top }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
