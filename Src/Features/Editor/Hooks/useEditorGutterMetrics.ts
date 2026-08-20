import { useMemo } from "react";
import { type EditorLayoutMetrics, measureEditorText } from "../Utils/EditorLayoutMetrics";

export interface GutterMetricsOptions {
  totalLines: number;
  visibleStartIndex: number;
  layout: EditorLayoutMetrics;
}

export interface GutterMetricsResult {
  /** 行号最大位数（例如 100 行是 3 位） */
  digitCount: number;
  /** 槽位推荐像素宽度（含内边距） */
  gutterWidth: number;
  /** 视口滚动偏移 translateY 像素值 */
  gutterOffsetY: number;
  /** 获取行号格式化文本 */
  formatLineNumber: (lineIndex: number) => string;
}

/**
 * 纯计算函数：根据总行数计算行号位数
 */
export function calculateGutterDigitCount(totalLines: number): number {
  return Math.max(2, String(Math.max(1, totalLines)).length);
}

/**
 * 纯计算函数：计算行号槽位宽度（像素）
 */
export function calculateGutterWidth(
  totalLines: number,
  characterWidth: number,
  paddingRight = 16,
): number {
  const digits = calculateGutterDigitCount(totalLines);
  return Math.max(36, digits * characterWidth + paddingRight);
}

/**
 * Hook：为编辑器主引擎提供行号槽位度量与视口平移计算
 */
export function useEditorGutterMetrics({
  totalLines,
  visibleStartIndex,
  layout,
}: GutterMetricsOptions): GutterMetricsResult {
  const digitCount = useMemo(() => calculateGutterDigitCount(totalLines), [totalLines]);

  const charWidth = useMemo(() => {
    try {
      return measureEditorText("0", layout) || layout.fontSize * 0.6;
    } catch {
      return layout.fontSize * 0.6;
    }
  }, [layout]);

  const gutterWidth = useMemo(
    () => calculateGutterWidth(totalLines, charWidth),
    [totalLines, charWidth],
  );

  const gutterOffsetY = useMemo(
    () => layout.contentInsetTop + Math.max(0, visibleStartIndex * layout.lineHeight),
    [layout.contentInsetTop, layout.lineHeight, visibleStartIndex],
  );

  const formatLineNumber = useMemo(() => {
    return (lineIndex: number) => String(lineIndex + 1);
  }, []);

  return {
    digitCount,
    gutterWidth,
    gutterOffsetY,
    formatLineNumber,
  };
}
