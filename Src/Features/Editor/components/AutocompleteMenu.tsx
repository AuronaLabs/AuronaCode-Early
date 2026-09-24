import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CompletionItem } from "../../../Foundation/Types/Lsp";

import { cn } from "../../../Shared/Utils/cn";
import { MarkdownRenderer } from "../../../UI/Components/MarkdownRenderer";
import { glassVariants } from "../../../UI/Core/GlassManager/variants";
import { positionEditorOverlay } from "../Utils/EditorOverlay";

export interface AutocompleteMenuProps {
  x: number;
  y: number;
  items: CompletionItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

const kindIconMap: Record<number, string> = {
  1: "t",
  2: "m",
  3: "f",
  4: "c",
  5: "f",
  6: "v",
  7: "c",
  8: "i",
  9: "m",
  10: "p",
  11: "u",
  12: "v",
  13: "e",
  14: "k",
  15: "s",
  16: "c",
  17: "f",
  18: "r",
  19: "f",
  20: "e",
  21: "c",
  22: "s",
  23: "e",
  24: "o",
  25: "t",
};

export function AutocompleteMenu({ x, y, items, selectedIndex, onSelect }: AutocompleteMenuProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const update = () => {
      const menu = menuRef.current;
      const next = positionEditorOverlay(
        { left: x, right: x, top: y, bottom: y },
        { width: menu?.offsetWidth ?? 520, height: menu?.offsetHeight ?? 300 },
        { width: window.innerWidth, height: window.innerHeight },
        8,
        0,
      );
      setPosition({ left: next.left, top: next.top });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [x, y]);

  useEffect(() => {
    if (scrollRef.current) {
      const container = scrollRef.current;
      const selectedItem = container.children[selectedIndex] as HTMLElement;
      if (selectedItem) {
        const itemTop = selectedItem.offsetTop;
        const itemBottom = itemTop + selectedItem.offsetHeight;
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.offsetHeight;

        if (itemTop < containerTop) {
          container.scrollTop = itemTop;
        } else if (itemBottom > containerBottom) {
          container.scrollTop = itemBottom - container.offsetHeight;
        }
      }
    }
  }, [selectedIndex]);

  if (!items || items.length === 0) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        glassVariants({ layer: "overlay" }),
        "fixed z-50 rounded-overlay overflow-hidden flex font-sans",
      )}
      style={{ left: position.left, top: position.top, maxHeight: "300px" }}
    >
      {}
      <div ref={scrollRef} className="w-[280px] overflow-y-auto aurona-scroll flex flex-col py-1">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const kindText = item.kind ? kindIconMap[item.kind] || "•" : "•";
          return (
            <button
              type="button"
              key={`${item.label}-${item.kind ?? "unknown"}-${item.insertText ?? item.detail ?? ""}`}
              onClick={() => onSelect(index)}
              className={`flex items-center px-3 py-1 cursor-pointer select-none text-[13px] transition-colors ${
                isSelected
                  ? "bg-[var(--material-surface)] text-[var(--color-text-highlight)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)]"
              }`}
            >
              <span className="w-5 text-center text-[11px] font-mono opacity-50 mr-2 flex-shrink-0">
                {kindText}
              </span>
              <span className="truncate flex-1 font-mono">{item.label}</span>
              {item.detail && (
                <span className="text-[11px] opacity-40 truncate ml-2 max-w-[100px]">
                  {item.detail}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {}
      {items[selectedIndex] &&
        (items[selectedIndex].detail || items[selectedIndex].documentation) && (
          <div className="w-[240px] border-l border-[var(--border-subtle)] bg-[var(--material-panel)] p-3 overflow-y-auto aurona-scroll">
            <div className="mb-2 whitespace-pre-wrap break-all font-mono text-[12px] text-[var(--color-accent)]">
              {items[selectedIndex].detail}
            </div>
            {/* 文档气泡：Markdown 渲染（含代码块），LSP documentation 原生格式 */}
            <div className="text-[12px] text-[var(--color-text-muted)] leading-relaxed break-words [&_code]:font-mono [&_code]:text-[11px] [&_pre]:overflow-x-auto [&_pre]:rounded-surface [&_pre]:border [&_pre]:border-[var(--border-subtle)] [&_pre]:bg-[var(--material-surface)] [&_pre]:p-2 [&_pre]:text-[11px] [&_pre]:leading-relaxed">
              <MarkdownRenderer
                content={
                  typeof items[selectedIndex].documentation === "string"
                    ? items[selectedIndex].documentation
                    : (items[selectedIndex].documentation?.value ?? "")
                }
              />
            </div>
          </div>
        )}
    </div>,
    document.body,
  );
}
