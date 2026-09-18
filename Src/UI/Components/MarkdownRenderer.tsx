import type React from "react";
import { useMemo } from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * 解析行内 Markdown 样式 (加粗、斜体、代码、链接)
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  // 正则匹配: **bold**, `code`, [link](url), *italic*
  const tokens: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    // 1. 代码 `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      tokens.push(
        <code
          key={`code-${keyIndex++}`}
          className="px-1.5 py-0.5 rounded-md bg-[var(--color-surface-3)] font-mono text-[12px] text-[var(--StatusInfo)] border border-[var(--border-subtle)]"
        >
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // 2. 加粗 **bold** 或 __bold__
    const boldMatch = remaining.match(/^(\*\*|__)(.*?)\1/);
    if (boldMatch) {
      tokens.push(
        <strong key={`bold-${keyIndex++}`} className="font-bold text-[var(--color-text-highlight)]">
          {renderInlineMarkdown(boldMatch[2])}
        </strong>,
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 3. 斜体 *italic* 或 _italic_
    const italicMatch = remaining.match(/^(\*|_)(.*?)\1/);
    if (italicMatch) {
      tokens.push(
        <em key={`italic-${keyIndex++}`} className="italic text-[var(--color-text-primary)]">
          {renderInlineMarkdown(italicMatch[2])}
        </em>,
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // 4. 链接 [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      tokens.push(
        <a
          key={`link-${keyIndex++}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--StatusInfo)] hover:underline hover:text-[var(--color-accent-hover)] transition-colors inline-flex items-center gap-0.5"
        >
          {linkMatch[1]}
        </a>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // 普通纯文本处理（匹配到下一个特殊符号前）
    const nextSpecial = remaining.search(/[`*_[]/);
    if (nextSpecial === -1) {
      tokens.push(remaining);
      break;
    }
    if (nextSpecial > 0) {
      tokens.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    } else {
      tokens.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return <>{tokens}</>;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  const renderedElements = useMemo(() => {
    if (!content) return null;

    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const elements: React.ReactNode[] = [];

    let inCodeBlock = false;
    let codeLanguage = "";
    let codeLines: string[] = [];

    let inTable = false;
    let tableRows: string[][] = [];

    let inList = false;
    let listType: "ul" | "ol" = "ul";
    let listItems: string[] = [];

    let inBlockquote = false;
    let blockquoteLines: string[] = [];

    const flushList = (key: number) => {
      if (!inList || listItems.length === 0) return;
      const ListTag = listType;
      elements.push(
        <ListTag
          key={`list-${key}`}
          className={`my-2.5 pl-5 space-y-1.5 text-[13.5px] text-[var(--color-text-secondary)] ${
            listType === "ul" ? "list-disc" : "list-decimal"
          }`}
        >
          {listItems.map((itemText) => (
            <li key={`li-${key}-${itemText.slice(0, 16)}`} className="leading-relaxed">
              {renderInlineMarkdown(itemText)}
            </li>
          ))}
        </ListTag>,
      );
      listItems = [];
      inList = false;
    };

    const flushBlockquote = (key: number) => {
      if (!inBlockquote || blockquoteLines.length === 0) return;
      elements.push(
        <blockquote
          key={`quote-${key}`}
          className="border-l-3 border-[var(--StatusInfo)]/80 bg-[var(--color-surface-2)]/80 rounded-r-xl px-4 py-2.5 my-3 text-[13px] text-[var(--color-text-secondary)] leading-relaxed shadow-sm"
        >
          {blockquoteLines.map((line) => (
            <p key={`quote-line-${key}-${line.slice(0, 16)}`}>{renderInlineMarkdown(line)}</p>
          ))}
        </blockquote>,
      );
      blockquoteLines = [];
      inBlockquote = false;
    };

    const flushTable = (key: number) => {
      if (!inTable || tableRows.length === 0) return;
      const [headerRow, ...bodyRows] = tableRows;
      elements.push(
        <div
          key={`table-${key}`}
          className="my-4 w-full overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/40 shadow-sm"
        >
          <table className="w-full text-left text-[12.5px] border-collapse">
            {headerRow && (
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--color-surface-3)]/60 text-[var(--color-text-highlight)] font-semibold">
                  {headerRow.map((cell) => (
                    <th key={`th-${key}-${cell.trim()}`} className="px-3.5 py-2">
                      {renderInlineMarkdown(cell.trim())}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {bodyRows.map((row) => {
                const rowKey = row
                  .map((c) => c.trim())
                  .join("-")
                  .slice(0, 24);
                return (
                  <tr
                    key={`tr-${key}-${rowKey}`}
                    className="border-b border-[var(--border-subtle)]/40 last:border-none hover:bg-[var(--color-surface-3)]/30 transition-colors"
                  >
                    {row.map((cell) => (
                      <td
                        key={`td-${key}-${rowKey}-${cell.trim()}`}
                        className="px-3.5 py-2 text-[var(--color-text-secondary)]"
                      >
                        {renderInlineMarkdown(cell.trim())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>,
      );
      tableRows = [];
      inTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 1. 代码块围栏 ```lang
      if (line.trim().startsWith("```")) {
        if (inCodeBlock) {
          elements.push(
            <div
              key={`codeblock-${i}`}
              className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/80 my-3.5 shadow-sm"
            >
              {codeLanguage && (
                <div className="px-3.5 py-1 bg-[var(--color-surface-3)] text-[11px] font-mono text-[var(--color-text-muted)] border-b border-[var(--border-subtle)] flex items-center justify-between">
                  <span>{codeLanguage}</span>
                </div>
              )}
              <pre className="p-3.5 text-[12.5px] font-mono leading-relaxed overflow-x-auto text-[var(--color-text-primary)]">
                <code>{codeLines.join("\n")}</code>
              </pre>
            </div>,
          );
          inCodeBlock = false;
          codeLines = [];
          codeLanguage = "";
        } else {
          flushList(i);
          flushBlockquote(i);
          flushTable(i);
          inCodeBlock = true;
          codeLanguage = line.trim().slice(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      // 2. 表格行 (| cell | cell |)
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        flushList(i);
        flushBlockquote(i);
        // 如果是分隔行 |--|--| 则跳过
        if (/^\|(\s*:?-+:?\s*\|)+$/.test(line.trim())) {
          continue;
        }
        const cells = line.trim().slice(1, -1).split("|");
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        tableRows.push(cells);
        continue;
      } else if (inTable) {
        flushTable(i);
      }

      // 3. 引用块 (> text)
      if (line.trim().startsWith(">")) {
        flushList(i);
        flushTable(i);
        inBlockquote = true;
        blockquoteLines.push(line.trim().replace(/^>\s?/, ""));
        continue;
      } else if (inBlockquote) {
        flushBlockquote(i);
      }

      // 4. 列表项 (- item, * item, 1. item)
      const ulMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
      const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);

      if (ulMatch) {
        flushBlockquote(i);
        flushTable(i);
        if (!inList || listType !== "ul") {
          flushList(i);
          inList = true;
          listType = "ul";
        }
        listItems.push(ulMatch[3]);
        continue;
      } else if (olMatch) {
        flushBlockquote(i);
        flushTable(i);
        if (!inList || listType !== "ol") {
          flushList(i);
          inList = true;
          listType = "ol";
        }
        listItems.push(olMatch[3]);
        continue;
      } else if (inList && line.trim() === "") {
        flushList(i);
      }

      // 5. 标题 (# ~ ######)
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushList(i);
        flushBlockquote(i);
        flushTable(i);

        const level = headingMatch[1].length;
        const text = headingMatch[2];

        if (level === 1) {
          elements.push(
            <h1
              key={`h1-${i}`}
              className="text-[20px] font-bold text-[var(--color-text-highlight)] border-b border-[var(--border-subtle)] pb-2 pt-3 first:pt-0"
            >
              {renderInlineMarkdown(text)}
            </h1>,
          );
        } else if (level === 2) {
          elements.push(
            <h2
              key={`h2-${i}`}
              className="text-[17px] font-bold text-[var(--color-text-highlight)] border-b border-[var(--border-subtle)]/60 pb-1.5 pt-3"
            >
              {renderInlineMarkdown(text)}
            </h2>,
          );
        } else if (level === 3) {
          elements.push(
            <h3
              key={`h3-${i}`}
              className="text-[15px] font-semibold text-[var(--color-text-highlight)] pt-2"
            >
              {renderInlineMarkdown(text)}
            </h3>,
          );
        } else {
          elements.push(
            <h4
              key={`h4-${i}`}
              className="text-[14px] font-semibold text-[var(--color-text-highlight)] pt-1.5"
            >
              {renderInlineMarkdown(text)}
            </h4>,
          );
        }
        continue;
      }

      // 6. 水平分割线 (--- / ***)
      if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
        flushList(i);
        flushBlockquote(i);
        flushTable(i);
        elements.push(
          <hr key={`hr-${i}`} className="border-t border-[var(--border-subtle)] my-4" />,
        );
        continue;
      }

      // 7. 普通段落 / 空行
      if (line.trim() === "") {
        continue;
      }

      flushList(i);
      flushBlockquote(i);
      flushTable(i);

      elements.push(
        <p
          key={`p-${i}`}
          className="text-[13.5px] leading-relaxed text-[var(--color-text-secondary)] my-1.5"
        >
          {renderInlineMarkdown(line)}
        </p>,
      );
    }

    // 尾部 flush
    flushList(lines.length);
    flushBlockquote(lines.length);
    flushTable(lines.length);

    return elements;
  }, [content]);

  return (
    <div className={`flex flex-col gap-1 w-full leading-relaxed ${className}`}>
      {renderedElements}
    </div>
  );
}
