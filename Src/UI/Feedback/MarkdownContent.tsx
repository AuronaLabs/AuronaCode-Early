import type { ReactNode } from "react";

const inline = (text: string): ReactNode[] => {
  const parts = text.split(/(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*)/g);
  let offset = 0;
  return parts.map((part) => {
    const key = `${offset}-${part}`;
    offset += part.length;
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded bg-[var(--material-panel)] px-1 py-0.5 font-mono text-[0.92em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) {
      return (
        <a
          key={key}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-[var(--TextMuted)] underline-offset-2 hover:text-[var(--TextHighlight)]"
        >
          {link[1]}
        </a>
      );
    }
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    return part;
  });
};

export function MarkdownContent({ source }: { source: string }) {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let code: string[] | null = null;
  let list: string[] = [];

  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-5">
        {list.map((item) => (
          <li key={item}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  lines.forEach((line) => {
    if (line.startsWith("```")) {
      flushList();
      if (code) {
        blocks.push(
          <pre
            key={`code-${blocks.length}`}
            className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--material-panel)] p-3 font-mono text-[12px]"
          >
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else code = [];
      return;
    }
    if (code) {
      code.push(line);
      return;
    }
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      list.push(item[1]);
      return;
    }
    flushList();
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push(
        <h3
          key={`heading-${blocks.length}`}
          className="pt-1 text-[14px] font-semibold text-[var(--TextHighlight)]"
        >
          {inline(heading[2])}
        </h3>,
      );
    } else if (line.trim()) {
      blocks.push(
        <p key={`paragraph-${blocks.length}`} className="leading-relaxed">
          {inline(line)}
        </p>,
      );
    }
  });
  flushList();
  const trailingCode = code as string[] | null;
  if (trailingCode)
    blocks.push(
      <pre
        key="code-final"
        className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--material-panel)] p-3 font-mono text-[12px]"
      >
        <code>{trailingCode.join("\n")}</code>
      </pre>,
    );

  return (
    <div className="flex flex-col gap-2.5 text-[13px] text-[var(--TextPrimary)]">{blocks}</div>
  );
}
