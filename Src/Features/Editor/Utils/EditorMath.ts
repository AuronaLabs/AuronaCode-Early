import { snapToGraphemeBoundary } from "./EditorLayoutMetrics";

export interface DiagnosticItem {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number; // 1: Error, 2: Warning
  message: string;
  source?: string;
}

export interface TextSegment {
  start: number;
  end: number;
  classes: string[];
}

export function normalizeEditorText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function sortSelection(sel: {
  start: { line: number; char: number };
  end: { line: number; char: number };
}) {
  const { start, end } = sel;
  if (start.line < end.line || (start.line === end.line && start.char < end.char)) {
    return { start, end };
  }
  return { start: end, end: start };
}

export function segmentLine(
  lineText: string,
  tokens: number[],
  searchQuery: string,
  searchMatches: { char: number }[],
  currentMatchIndex: number,
  globalSearchMatches: { line: number; char: number }[],
  lineIndex: number,
  diagnostics: DiagnosticItem[],
): TextSegment[] {
  const lineLength = lineText.length;
  if (lineLength === 0) return [];

  // 1. 收集所有区间断点
  const breakpointsSet = new Set<number>([0, lineLength]);

  // 语法高亮区间
  const tokenRanges: { start: number; end: number; className: string }[] = [];
  for (let i = 0; i < tokens.length; i += 3) {
    const start = tokens[i];
    const len = tokens[i + 1];
    const type = tokens[i + 2];
    const end = Math.min(start + len, lineLength);
    if (start < lineLength) {
      breakpointsSet.add(start);
      breakpointsSet.add(end);
      tokenRanges.push({ start, end, className: `hl-token-${type}` });
    }
  }

  // 搜索高亮区间
  const searchRanges: { start: number; end: number; className: string }[] = [];
  if (searchQuery) {
    const queryLen = searchQuery.length;
    searchMatches.forEach((match) => {
      const start = match.char;
      const end = Math.min(start + queryLen, lineLength);
      breakpointsSet.add(start);
      breakpointsSet.add(end);

      const globalMatchIdx = globalSearchMatches.findIndex(
        (gm) => gm.line === lineIndex && gm.char === start,
      );
      const isActive = globalMatchIdx === currentMatchIndex;
      searchRanges.push({
        start,
        end,
        className: isActive ? "hl-search-active" : "hl-search",
      });
    });
  }

  // LSP 诊断画线区间
  const diagRanges: { start: number; end: number; className: string }[] = [];
  diagnostics.forEach((diag) => {
    const start = diag.range.start.character;
    const end = Math.min(diag.range.end.character, lineLength);
    if (start < lineLength) {
      breakpointsSet.add(start);
      breakpointsSet.add(end);
      diagRanges.push({
        start,
        end,
        className: diag.severity === 1 ? "hl-diag-error" : "hl-diag-warning",
      });
    }
  });

  // Highlight, search and diagnostic protocols use UTF-16 offsets. Normalize
  // every visual split so a token never tears an emoji or a combining cluster
  // into separately measured DOM spans.
  const breakpoints = Array.from(
    new Set(Array.from(breakpointsSet, (point) => snapToGraphemeBoundary(lineText, point))),
  ).sort((a, b) => a - b);

  // 2. 线性扫描拆分
  const segments: TextSegment[] = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const start = breakpoints[i];
    const end = breakpoints[i + 1];
    if (start === end) continue;

    const classes: string[] = [];

    // 匹配词法 Token
    for (const tr of tokenRanges) {
      if (start >= tr.start && end <= tr.end) {
        classes.push(tr.className);
        break;
      }
    }

    // 匹配搜索
    for (const sr of searchRanges) {
      if (start >= sr.start && end <= sr.end) {
        classes.push(sr.className);
      }
    }

    // 匹配诊断
    for (const dr of diagRanges) {
      if (start >= dr.start && end <= dr.end) {
        classes.push(dr.className);
      }
    }

    segments.push({ start, end, classes });
  }

  return segments;
}

export function parseHighlightedHtmlToLineTokens(html: string, totalLines: number): number[][] {
  const linesTokens: number[][] = Array.from({ length: totalLines }, () => []);
  let currentLine = 0;
  let currentOffset = 0;

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");

  const classToType: Record<string, number> = {
    "hljs-keyword": 1,
    "hljs-literal": 1,
    "hljs-symbol": 1,
    "hljs-string": 2,
    "hljs-regexp": 2,
    "hljs-number": 3,
    "hljs-function": 4,
    "hljs-title": 4,
    "hljs-attr": 5,
    "hljs-variable": 5,
    "hljs-params": 5,
    "hljs-comment": 6,
    "hljs-operator": 7,
    "hljs-punctuation": 7,
    "hljs-built_in": 8,
    "hljs-bullet": 8,
    "hljs-type": 9,
    "hljs-class": 9,
    "hljs-meta": 5,
  };

  const walk = (node: Node, activeClasses: string[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      const textLines = text.split(/\r?\n/);

      textLines.forEach((textLine, i) => {
        if (i > 0) {
          currentLine++;
          currentOffset = 0;
        }

        if (textLine.length > 0) {
          let type = 0;
          for (const cls of activeClasses) {
            if (classToType[cls]) {
              type = classToType[cls];
              break;
            }
          }

          if (type > 0 && currentLine < totalLines) {
            linesTokens[currentLine].push(currentOffset, textLine.length, type);
          }
          currentOffset += textLine.length;
        }
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const classes = Array.from(el.classList);
      const newActiveClasses = [...classes, ...activeClasses];
      el.childNodes.forEach((child) => {
        walk(child, newActiveClasses);
      });
    }
  };

  doc.body.childNodes.forEach((child) => {
    walk(child, []);
  });
  return linesTokens;
}

export function findWordBoundaries(text: string, index: number) {
  let start = index;
  let end = index;
  const wordCharRegex = /[a-zA-Z0-9_]/;
  while (start > 0 && wordCharRegex.test(text[start - 1])) {
    start--;
  }
  while (end < text.length && wordCharRegex.test(text[end])) {
    end++;
  }
  if (start === end && index < text.length) {
    end = index + 1;
  }
  return { start, end };
}
