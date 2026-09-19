import { useCallback, useEffect, useRef } from "react";
import type { MinimapDecoration } from "./MinimapDecorations";

export interface UseMinimapRendererProps {
  documentLines: string[];
  linesTokens: number[][];
  totalLines: number;
  scrollTop: number;
  viewportHeight: number;
  lineHeight: number;
  minimapWidth: number;
  decorations: MinimapDecoration[];
  onScrollTo: (targetScrollTop: number) => void;
}

const MINIMAP_LINE_HEIGHT = 2; // Minimap 每行渲染高度为 2px
const MINIMAP_CHAR_WIDTH = 1.2; // 每个字符在 Minimap 上的压缩宽度为 1.2px

/** token 类型 → 语法色 CSS 变量（唯一事实源是 Theme.css 的 --Syntax*，杜绝双源漂移） */
const TOKEN_COLOR_VARS: Record<number, { variable: string; fallback: string }> = {
  1: { variable: "--SyntaxKeyword", fallback: "#c084fc" },
  2: { variable: "--SyntaxString", fallback: "#98c379" },
  3: { variable: "--SyntaxNumber", fallback: "#38bdf8" },
  4: { variable: "--SyntaxFunction", fallback: "#c084fc" },
  5: { variable: "--SyntaxVariable", fallback: "#e0af68" },
  6: { variable: "--SyntaxComment", fallback: "#64748b" },
  7: { variable: "--SyntaxOperator", fallback: "#94a3b8" },
  8: { variable: "--SyntaxBuiltin", fallback: "#56b6c2" },
  9: { variable: "--SyntaxTypeHint", fallback: "#7aa2f7" },
};

const DEFAULT_MINIMAP_COLOR = "#94a3b8";

/** 从文档根节点解析当前主题下的语法色（浅/深色与强调色切换后随渲染自动刷新） */
function resolveTokenColors(): Record<number, string> {
  const style = getComputedStyle(document.documentElement);
  const colors: Record<number, string> = {};
  for (const [type, spec] of Object.entries(TOKEN_COLOR_VARS)) {
    const value = style.getPropertyValue(spec.variable).trim();
    colors[Number(type)] = value || spec.fallback;
  }
  return colors;
}

export function useMinimapRenderer({
  documentLines,
  linesTokens,
  totalLines,
  scrollTop,
  viewportHeight,
  lineHeight,
  minimapWidth,
  decorations,
  onScrollTo,
}: UseMinimapRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);

  // 计算滑块在 Minimap 上的位置与高度
  const totalContentHeight = Math.max(1, totalLines * lineHeight);
  const minimapContentHeight = totalLines * MINIMAP_LINE_HEIGHT;

  // 滑块高度占 Minimap 的比例
  const sliderHeight = Math.max(20, (viewportHeight / totalContentHeight) * minimapContentHeight);
  // 滑块当前顶部位置
  const sliderTop = (scrollTop / totalContentHeight) * minimapContentHeight;

  // 1. Canvas 2D 离屏像素着色渲染
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = minimapWidth;
    const height = Math.max(viewportHeight, minimapContentHeight);

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // 绘制代码文本像素点阵
    const tokenColors = resolveTokenColors();
    const lineCount = Math.min(totalLines, documentLines.length);
    for (let l = 0; l < lineCount; l++) {
      const lineText = documentLines[l];
      if (!lineText) continue;

      const y = l * MINIMAP_LINE_HEIGHT;
      const tokens = linesTokens[l] || [];

      // 提取前导空白缩进
      const leadingSpaces = lineText.search(/\S/);
      const indentOffset = (leadingSpaces === -1 ? 0 : leadingSpaces) * MINIMAP_CHAR_WIDTH;

      if (tokens.length >= 3) {
        for (let i = 0; i < tokens.length; i += 3) {
          const offset = tokens[i];
          const len = tokens[i + 1];
          const tokenType = tokens[i + 2];

          ctx.fillStyle = tokenColors[tokenType] || DEFAULT_MINIMAP_COLOR;
          const x = 4 + offset * MINIMAP_CHAR_WIDTH;
          const w = Math.max(1, len * MINIMAP_CHAR_WIDTH);
          ctx.fillRect(x, y, w, MINIMAP_LINE_HEIGHT - 0.5);
        }
      } else {
        // 无 token 时绘制纯文本微像素块
        ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
        const trimmedLength = Math.min(60, lineText.trim().length);
        if (trimmedLength > 0) {
          ctx.fillRect(
            4 + indentOffset,
            y,
            trimmedLength * MINIMAP_CHAR_WIDTH,
            MINIMAP_LINE_HEIGHT - 0.5,
          );
        }
      }
    }

    // 绘制右侧装饰标记条 (Decorations)
    for (const dec of decorations) {
      const y = dec.line * MINIMAP_LINE_HEIGHT;
      ctx.fillStyle = dec.color;
      ctx.fillRect(width - 4, y, 4, Math.max(2, MINIMAP_LINE_HEIGHT));
    }

    ctx.restore();
  }, [
    decorations,
    documentLines,
    linesTokens,
    minimapContentHeight,
    minimapWidth,
    totalLines,
    viewportHeight,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // 2. 点击与拖拽事件
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const clickY = e.clientY - rect.top;

      // 如果点击在滑块内部，开始拖拽
      if (clickY >= sliderTop && clickY <= sliderTop + sliderHeight) {
        isDraggingRef.current = true;
        dragStartYRef.current = e.clientY;
        dragStartScrollTopRef.current = scrollTop;
      } else {
        // 点击在滑块外部，直接居中跳转
        const targetSliderCenterY = clickY;
        const targetScrollRatio =
          (targetSliderCenterY - sliderHeight / 2) / (minimapContentHeight - sliderHeight);
        const targetScrollTop = Math.max(
          0,
          Math.min(totalContentHeight - viewportHeight, targetScrollRatio * totalContentHeight),
        );
        onScrollTo(targetScrollTop);
      }
    },
    [
      minimapContentHeight,
      onScrollTo,
      scrollTop,
      sliderHeight,
      sliderTop,
      totalContentHeight,
      viewportHeight,
    ],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaY = e.clientY - dragStartYRef.current;
      const scrollRatio = deltaY / (minimapContentHeight || 1);
      const deltaScroll = scrollRatio * totalContentHeight;
      const targetScroll = Math.max(
        0,
        Math.min(totalContentHeight - viewportHeight, dragStartScrollTopRef.current + deltaScroll),
      );
      onScrollTo(targetScroll);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [minimapContentHeight, onScrollTo, totalContentHeight, viewportHeight]);

  return {
    canvasRef,
    sliderTop,
    sliderHeight,
    handleMouseDown,
  };
}
