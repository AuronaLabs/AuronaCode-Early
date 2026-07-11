import React, { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  placement?: "top" | "bottom" | "left" | "right";
};

export function Tooltip({ content, children, delay = 300, placement = "top" }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [actualPlacement, setActualPlacement] = useState(placement);
  const [actualAlign, setActualAlign] = useState("center");
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();

        let x = 0;
        let y = 0;
        const gap = 8;
        let currentPlacement = placement;
        let align = "center";

        switch (currentPlacement) {
          case "top":
            y = rect.top - gap;
            if (y - 30 < 0) currentPlacement = "bottom";
            break;
          case "bottom":
            y = rect.bottom + gap;
            if (y + 30 > window.innerHeight) currentPlacement = "top";
            break;
          case "left":
            x = rect.left - gap;
            if (x - 60 < 0) currentPlacement = "right";
            break;
          case "right":
            x = rect.right + gap;
            if (x + 60 > window.innerWidth) currentPlacement = "left";
            break;
        }

        if (currentPlacement === "top") y = rect.top - gap;
        if (currentPlacement === "bottom") y = rect.bottom + gap;

        if (currentPlacement === "top" || currentPlacement === "bottom") {
          if (rect.right > window.innerWidth - 60) align = "end";
          else if (rect.left < 60) align = "start";

          if (align === "center") x = rect.left + rect.width / 2;
          else if (align === "end") x = rect.right;
          else if (align === "start") x = rect.left;
        }

        if (currentPlacement === "left" || currentPlacement === "right") {
          if (rect.bottom > window.innerHeight - 30) align = "end";
          else if (rect.top < 30) align = "start";

          if (align === "center") y = rect.top + rect.height / 2;
          else if (align === "end") y = rect.bottom;
          else if (align === "start") y = rect.top;
        }

        setCoords({ x, y });
        setActualPlacement(currentPlacement);
        setActualAlign(align);
        setIsVisible(true);
      }
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  useEffect(() => {
    const handleGlobalHide = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setIsVisible(false);
    };

    window.addEventListener("blur", handleGlobalHide);
    window.addEventListener("scroll", handleGlobalHide, true); // true for capturing scroll events from any scrollable element

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.removeEventListener("blur", handleGlobalHide);
      window.removeEventListener("scroll", handleGlobalHide, true);
    };
  }, []);

  const getTransform = () => {
    const xTrans = actualAlign === "center" ? "-50%" : actualAlign === "end" ? "-100%" : "0";
    const yTrans = actualAlign === "center" ? "-50%" : actualAlign === "end" ? "-100%" : "0";

    switch (actualPlacement) {
      case "top":
        return `translate(${xTrans}, -100%)`;
      case "bottom":
        return `translate(${xTrans}, 0)`;
      case "left":
        return `translate(-100%, ${yTrans})`;
      case "right":
        return `translate(0, ${yTrans})`;
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-flex items-center justify-center"
      >
        {children}
      </div>
      {isVisible &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none px-2.5 py-1.5 text-[12px] font-medium text-[var(--TextHighlight)] bg-[var(--GlassSurface)] backdrop-blur-xl border border-[var(--GlassBorder)] rounded-lg animate-in fade-in duration-200 whitespace-nowrap shadow-xl shadow-black/10"
            style={{
              left: coords.x,
              top: coords.y,
              transform: getTransform(),
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
