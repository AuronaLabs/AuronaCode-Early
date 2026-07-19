export interface EditorLayoutMetrics {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  contentInsetX: number;
  contentInsetTop: number;
  tabSize: number;
  devicePixelRatio: number;
}

export const DEFAULT_EDITOR_LAYOUT: EditorLayoutMetrics = {
  fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
  fontSize: 14,
  lineHeight: 24,
  contentInsetX: 8,
  contentInsetTop: 0,
  tabSize: 2,
  devicePixelRatio: 1,
};

let measurementContext: CanvasRenderingContext2D | null | undefined;

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (measurementContext !== undefined) return measurementContext;
  if (typeof document === "undefined") return null;
  measurementContext = document.createElement("canvas").getContext("2d");
  return measurementContext;
}

function readPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativePixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readEditorLayoutMetrics(element: HTMLElement): EditorLayoutMetrics {
  const styles = getComputedStyle(element);
  return {
    fontFamily:
      styles.getPropertyValue("--EditorFontFamily").trim() || DEFAULT_EDITOR_LAYOUT.fontFamily,
    fontSize: readPixels(
      styles.getPropertyValue("--EditorFontSize"),
      DEFAULT_EDITOR_LAYOUT.fontSize,
    ),
    lineHeight: readPixels(
      styles.getPropertyValue("--EditorLineHeight"),
      DEFAULT_EDITOR_LAYOUT.lineHeight,
    ),
    contentInsetX: readPixels(
      styles.getPropertyValue("--EditorContentInset"),
      DEFAULT_EDITOR_LAYOUT.contentInsetX,
    ),
    contentInsetTop: readNonNegativePixels(
      styles.getPropertyValue("--EditorContentInsetTop"),
      DEFAULT_EDITOR_LAYOUT.contentInsetTop,
    ),
    tabSize: Math.max(
      1,
      Math.round(
        readPixels(styles.getPropertyValue("--EditorTabSize"), DEFAULT_EDITOR_LAYOUT.tabSize),
      ),
    ),
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

function expandTabs(text: string, tabSize: number): string {
  let column = 0;
  let expanded = "";
  const boundaries = getGraphemeBoundaries(text);
  for (let index = 1; index < boundaries.length; index += 1) {
    const character = text.slice(boundaries[index - 1], boundaries[index]);
    if (character === "\t") {
      const spaces = tabSize - (column % tabSize);
      expanded += " ".repeat(spaces);
      column += spaces;
    } else {
      expanded += character;
      column += 1;
    }
  }
  return expanded;
}

export function measureEditorText(text: string, metrics: EditorLayoutMetrics): number {
  const measurementContext = getMeasurementContext();
  if (!measurementContext) return expandTabs(text, metrics.tabSize).length * metrics.fontSize * 0.6;
  measurementContext.font = `${metrics.fontSize}px ${metrics.fontFamily}`;
  const tabWidth = measurementContext.measureText(" ".repeat(metrics.tabSize)).width;
  let width = 0;
  const boundaries = getGraphemeBoundaries(text);
  for (let index = 1; index < boundaries.length; index += 1) {
    const character = text.slice(boundaries[index - 1], boundaries[index]);
    if (character === "\t" && tabWidth > 0) {
      const remainder = width % tabWidth;
      width += remainder < 0.01 ? tabWidth : tabWidth - remainder;
    } else {
      width += measurementContext.measureText(character).width;
    }
  }
  return width;
}

/** UTF-16 boundaries safe for caret, selection and editing operations. */
export function getGraphemeBoundaries(text: string): number[] {
  const boundaries = [0];
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const segment of segmenter.segment(text)) {
      const end = segment.index + segment.segment.length;
      if (end > boundaries[boundaries.length - 1]) boundaries.push(end);
    }
  } else {
    let offset = 0;
    for (const character of text) {
      offset += character.length;
      boundaries.push(offset);
    }
  }
  if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length);
  return boundaries;
}

export function previousGraphemeBoundary(text: string, offset: number): number {
  const boundaries = getGraphemeBoundaries(text);
  const clamped = Math.max(0, Math.min(offset, text.length));
  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    if (boundaries[index] < clamped) return boundaries[index];
  }
  return 0;
}

export function nextGraphemeBoundary(text: string, offset: number): number {
  const boundaries = getGraphemeBoundaries(text);
  const clamped = Math.max(0, Math.min(offset, text.length));
  for (const boundary of boundaries) {
    if (boundary > clamped) return boundary;
  }
  return text.length;
}

/** Snap an untrusted DOM/LSP offset away from the middle of a grapheme. */
export function snapToGraphemeBoundary(text: string, offset: number): number {
  const boundaries = getGraphemeBoundaries(text);
  const clamped = Math.max(0, Math.min(offset, text.length));
  if (boundaries.includes(clamped)) return clamped;

  for (let index = 1; index < boundaries.length; index += 1) {
    if (boundaries[index] > clamped) {
      const previous = boundaries[index - 1];
      return clamped - previous < boundaries[index] - clamped ? previous : boundaries[index];
    }
  }
  return text.length;
}

export function editorTextIndexAtX(
  text: string,
  relativeX: number,
  metrics: EditorLayoutMetrics,
): number {
  if (relativeX <= 0) return 0;
  const boundaries = getGraphemeBoundaries(text);
  const totalWidth = measureEditorText(text, metrics);
  if (relativeX >= totalWidth) return text.length;

  for (let index = 1; index < boundaries.length; index += 1) {
    const previous = boundaries[index - 1];
    const next = boundaries[index];
    const previousWidth = measureEditorText(text.slice(0, previous), metrics);
    const nextWidth = measureEditorText(text.slice(0, next), metrics);
    if (relativeX < (previousWidth + nextWidth) / 2) return previous;
  }
  return text.length;
}

type DomCaretRangeDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
};

function textNodeAtOffset(
  root: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let lastNode: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    lastNode = node;
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
  }
  return lastNode ? { node: lastNode, offset: lastNode.data.length } : null;
}

/**
 * Measures a visible text range from the DOM that actually paints it. Canvas
 * stays as an off-screen fallback only; it cannot reliably model font fallback,
 * syntax token weights or complex-script shaping.
 */
export function measureRenderedEditorRange(
  lineElement: HTMLElement,
  startUtf16: number,
  endUtf16: number,
): { left: number; width: number } | null {
  if (typeof document === "undefined") return null;
  const textRoot = lineElement.querySelector<HTMLElement>("[data-editor-text-content]");
  if (!textRoot) return null;

  const start = textNodeAtOffset(textRoot, startUtf16);
  const end = textNodeAtOffset(textRoot, endUtf16);
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const rect = range.getBoundingClientRect();
  const lineRect = lineElement.getBoundingClientRect();

  if (endUtf16 === startUtf16 || rect.width === 0) {
    const rootStart = textNodeAtOffset(textRoot, 0);
    if (!rootStart) return null;
    const prefix = document.createRange();
    prefix.setStart(rootStart.node, rootStart.offset);
    prefix.setEnd(end.node, end.offset);
    const prefixRect = prefix.getBoundingClientRect();
    const left =
      prefixRect.width > 0
        ? prefixRect.right - lineRect.left
        : textRoot.getBoundingClientRect().left - lineRect.left;
    return { left, width: 0 };
  }

  return { left: rect.left - lineRect.left, width: rect.width };
}

/** Resolves a pointer to the same UTF-16 coordinate system as the document model. */
export function editorTextIndexFromPoint(
  lineElement: HTMLElement,
  clientX: number,
  clientY: number,
  lineText: string,
): number | null {
  if (typeof document === "undefined") return null;
  const textRoot = lineElement.querySelector<HTMLElement>("[data-editor-text-content]");
  if (!textRoot) return null;

  const pointDocument = document as DomCaretRangeDocument;
  const range = pointDocument.caretRangeFromPoint?.(clientX, clientY);
  const caretPosition = pointDocument.caretPositionFromPoint?.(clientX, clientY);
  const position = range
    ? { node: range.startContainer, offset: range.startOffset }
    : caretPosition
      ? { node: caretPosition.offsetNode, offset: caretPosition.offset }
      : null;
  if (!position || !textRoot.contains(position.node)) return null;

  const before = document.createRange();
  before.selectNodeContents(textRoot);
  before.setEnd(position.node, position.offset);
  return snapToGraphemeBoundary(lineText, before.toString().length);
}

export function sameEditorLayout(a: EditorLayoutMetrics, b: EditorLayoutMetrics): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.lineHeight === b.lineHeight &&
    a.contentInsetX === b.contentInsetX &&
    a.contentInsetTop === b.contentInsetTop &&
    a.tabSize === b.tabSize &&
    a.devicePixelRatio === b.devicePixelRatio
  );
}
