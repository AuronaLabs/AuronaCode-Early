import React, { useEffect, useRef } from "react";

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
}

export interface AutocompleteMenuProps {
  x: number;
  y: number;
  items: CompletionItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

const kindIconMap: Record<number, string> = {
  1: "t", // Text
  2: "m", // Method
  3: "f", // Function
  4: "c", // Constructor
  5: "f", // Field
  6: "v", // Variable
  7: "c", // Class
  8: "i", // Interface
  9: "m", // Module
  10: "p", // Property
  11: "u", // Unit
  12: "v", // Value
  13: "e", // Enum
  14: "k", // Keyword
  15: "s", // Snippet
  16: "c", // Color
  17: "f", // File
  18: "r", // Reference
  19: "f", // Folder
  20: "e", // EnumMember
  21: "c", // Constant
  22: "s", // Struct
  23: "e", // Event
  24: "o", // Operator
  25: "t", // TypeParameter
};

export function AutocompleteMenu({
  x,
  y,
  items,
  selectedIndex,
  onSelect,
}: AutocompleteMenuProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to keep selected item in view
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

  return (
    <div
      className="fixed z-50 bg-white/80 dark:bg-black/80 backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-2xl rounded-lg overflow-hidden flex font-sans"
      style={{ left: x, top: y, maxHeight: "300px" }}
    >
      {/* 补全列表侧 */}
      <div 
        ref={scrollRef}
        className="w-[280px] overflow-y-auto aurona-scroll flex flex-col py-1"
      >
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const kindText = item.kind ? kindIconMap[item.kind] || "•" : "•";
          return (
            <div
              key={index}
              onClick={() => onSelect(index)}
              className={`flex items-center px-3 py-1 cursor-pointer select-none text-[13px] transition-colors ${
                isSelected 
                  ? "bg-blue-500/20 text-blue-700 dark:text-blue-300" 
                  : "text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5"
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
            </div>
          );
        })}
      </div>
      
      {/* 详情侧 (如果有选中且有文档) */}
      {items[selectedIndex] && (items[selectedIndex].detail || items[selectedIndex].documentation) && (
        <div className="w-[240px] border-l border-black/5 dark:border-white/5 bg-gray-50/50 dark:bg-gray-900/50 p-3 overflow-y-auto aurona-scroll">
          <div className="text-[12px] font-mono text-blue-600 dark:text-blue-400 mb-2 whitespace-pre-wrap break-all">
            {items[selectedIndex].detail}
          </div>
          <div className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap break-all">
            {typeof items[selectedIndex].documentation === 'string' 
              ? items[selectedIndex].documentation 
              : (items[selectedIndex].documentation as any)?.value}
          </div>
        </div>
      )}
    </div>
  );
}
