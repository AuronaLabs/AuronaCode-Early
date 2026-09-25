import type { ReactNode } from "react";
import { isValidElement, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { FileSystemService } from "../../../Core/FileSystemService";
import { useLocale } from "../../../Foundation/I18n";
import { FileSystemCommands } from "../../../Foundation/IPC/FileSystemCommands";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";
import "./MarkdownPreview.css";

type MarkdownPreviewProps = {
  content: string;
  path: string;
  initialScrollTop: number;
  onScrollTopChange: (scrollTop: number) => void;
};

type PreviewHeading = { id: string; title: string; level: number };

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return "";
}

function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const code = textFromNode(children).replace(/\n$/, "");
  const child = Array.isArray(children) ? children.find(isValidElement) : children;
  const className = isValidElement<{ className?: string }>(child) ? child.props.className : "";
  const language = className?.match(/language-([\w+#.-]+)/)?.[1] ?? "";

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="markdown-preview-code">
      <div className="markdown-preview-code-header">
        <span>{language}</span>
        <Tooltip content={copied ? t("ai.copied") : t("ai.copyCode")}>
          <button
            type="button"
            aria-label={copied ? t("ai.copied") : t("ai.copyCode")}
            onClick={() =>
              void navigator.clipboard
                .writeText(code)
                .then(() => setCopied(true))
                .catch(() => undefined)
            }
          >
            {copied ? <Icons.Check size={15} /> : <Icons.Copy size={15} />}
          </button>
        </Tooltip>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function localReferencePath(documentPath: string, source: string): string | null {
  if (!source || /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(source)) return null;
  try {
    const reference = decodeURIComponent(source.split(/[?#]/, 1)[0]);
    if (!reference || reference.includes("\0")) return null;
    return FileSystemService.joinPath(FileSystemService.dirname(documentPath), reference);
  } catch {
    return null;
  }
}

function MarkdownImage({
  src,
  alt,
  documentPath,
}: {
  src?: string;
  alt?: string;
  documentPath: string;
}) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setResolved(null);
    if (!src) return;
    if (/^https:\/\//i.test(src)) {
      setResolved(src);
      return;
    }
    const path = localReferencePath(documentPath, src);
    if (!path) return;
    void FileSystemCommands.readImageDataUrl(path)
      .then((dataUrl) => {
        if (current) setResolved(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [documentPath, src]);

  if (!resolved) return <span className="markdown-preview-image-placeholder">{alt || src}</span>;
  return <img src={resolved} alt={alt || ""} loading="lazy" />;
}

export function MarkdownPreview({
  content,
  path,
  initialScrollTop,
  onScrollTopChange,
}: MarkdownPreviewProps) {
  const { t } = useLocale();
  const openFile = useWorkbenchStore((state) => state.openFile);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialScrollTopRef = useRef(initialScrollTop);
  const [renderedContent, setRenderedContent] = useState(content);
  const [headings, setHeadings] = useState<PreviewHeading[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => setRenderedContent(content), 120);
    return () => window.clearTimeout(timer);
  }, [content]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = initialScrollTopRef.current;
  }, []);

  useEffect(() => {
    if (!renderedContent) {
      setHeadings([]);
      return;
    }
    const article = scrollRef.current?.querySelector(".markdown-preview-prose");
    setHeadings(
      Array.from(article?.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]") ?? []).map(
        (heading) => ({
          id: heading.id,
          title: heading.textContent?.trim() || heading.id,
          level: Number(heading.tagName.slice(1)),
        }),
      ),
    );
  }, [renderedContent]);

  const components: Components = {
    pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
    a: ({ href, children }) => {
      const remote = Boolean(href && /^https?:\/\//i.test(href));
      const localPath = href ? localReferencePath(path, href) : null;
      return (
        <a
          href={remote || href?.startsWith("#") ? href : undefined}
          target={remote ? "_blank" : undefined}
          rel={remote ? "noopener noreferrer" : undefined}
          onClick={(event) => {
            if (!localPath) return;
            event.preventDefault();
            openFile(localPath);
          }}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} documentPath={path} />,
  };

  return (
    <div
      ref={scrollRef}
      className="markdown-preview-scroll aurona-scroll h-full overflow-y-auto"
      onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
    >
      <div className="markdown-preview-document mx-auto w-full max-w-[860px] px-6 pb-28 pt-10 sm:px-10">
        <header className="markdown-preview-header">
          <Icons.FileMd size={18} stroke={1.6} />
          <span>{t("editor.previewView")}</span>
          {headings.length > 0 && (
            <details className="markdown-preview-outline">
              <summary aria-label={t("sidebar.outline")}>
                <Icons.List size={16} />
                <span>{t("sidebar.outline")}</span>
              </summary>
              <nav aria-label={t("sidebar.outline")}>
                {headings.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    className={`markdown-preview-outline-level-${heading.level}`}
                    aria-label={heading.title}
                    onClick={(event) => {
                      const target = scrollRef.current?.querySelector<HTMLElement>(
                        `#${CSS.escape(heading.id)}`,
                      );
                      target?.scrollIntoView({ block: "start", behavior: "smooth" });
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                  >
                    {heading.title}
                  </button>
                ))}
              </nav>
            </details>
          )}
        </header>
        <article className="markdown-preview-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug]}
            skipHtml
            components={components}
          >
            {renderedContent}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
