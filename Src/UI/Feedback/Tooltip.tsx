import React, { useState, useRef, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";

type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
};

export function Tooltip({ content, children, delay = 300 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        
        // Default coordinates
        let x = rect.left + rect.width / 2;
        let y = rect.bottom + 6;
        
        // Smart bounds checking
        // Prevent clipping on right edge
        if (x + 60 > window.innerWidth) {
          x = window.innerWidth - 60;
        }
        // Prevent clipping on left edge
        if (x - 60 < 0) {
          x = 60;
        }
        // Prevent clipping on bottom
        if (y + 30 > window.innerHeight) {
          y = rect.top - 30; // show above
        }

        setCoords({ x, y });
        setIsVisible(true);
      }
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

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
            className="fixed z-[9999] pointer-events-none px-2.5 py-1.5 text-[12px] font-medium text-[var(--ColorText)] bg-[var(--ColorTitleBar)] border border-[var(--ColorPanelBorder)] rounded-md shadow-md animate-in fade-in zoom-in-95 duration-200 whitespace-nowrap"
            style={{
              left: coords.x,
              top: coords.y,
              transform: "translateX(-50%)",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
