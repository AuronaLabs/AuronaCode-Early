import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

type AgentMarkdownProps = { content: string };

const components: Components = {
  a: ({ href, children }) => {
    const safeHref = href && /^(?:https?:|mailto:|#)/i.test(href) ? href : undefined;
    return (
      <a href={safeHref} target={safeHref?.startsWith("#") ? undefined : "_blank"} rel="noreferrer">
        {children}
      </a>
    );
  },
  pre: ({ children }) => <pre className="agent-markdown-code-block">{children}</pre>,
};

export function AgentMarkdown({ content }: AgentMarkdownProps) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
