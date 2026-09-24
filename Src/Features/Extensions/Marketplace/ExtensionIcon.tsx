import { type ReactNode, useState } from "react";
import { Icons } from "../../../UI/Icons/IconManager";

interface ExtensionIconProps {
  icon?: string;
  name?: string;
  size?: number;
  color?: string;
  className?: string;
}

// Tabler 常用内置图标映射表
const TABLER_ICON_MAP: Record<string, (size: number, cls: string) => ReactNode> = {
  code: (s, c) => <Icons.FileCode size={s} className={c} />,
  sparkles: (s, c) => <Icons.Sparkles size={s} className={c} />,
  terminal: (s, c) => <Icons.Terminal size={s} className={c} />,
  database: (s, c) => <Icons.Database size={s} className={c} />,
  package: (s, c) => <Icons.Package size={s} className={c} />,
  list: (s, c) => <Icons.List size={s} className={c} />,
  palette: (s, c) => <Icons.Palette size={s} className={c} />,
  git: (s, c) => <Icons.Git size={s} className={c} />,
  python: (s, c) => <Icons.FilePy size={s} className={c} />,
  rust: (s, c) => <Icons.FileRust size={s} className={c} />,
  cpp: (s, c) => <Icons.FileCpp size={s} className={c} />,
  golang: (s, c) => <Icons.FileGo size={s} className={c} />,
  vue: (s, c) => <Icons.FileVue size={s} className={c} />,
  html: (s, c) => <Icons.FileHtml size={s} className={c} />,
  css: (s, c) => <Icons.FileCss size={s} className={c} />,
  json: (s, c) => <Icons.FileJson size={s} className={c} />,
  markdown: (s, c) => <Icons.FileMd size={s} className={c} />,
  typescript: (s, c) => <Icons.FileTs size={s} className={c} />,
  javascript: (s, c) => <Icons.FileJs size={s} className={c} />,
};

// 智能提取默认颜色
function getDefaultColorForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("python") || lower.includes("pyright")) return "#38bdf8";
  if (lower.includes("rust") || lower.includes("cargo")) return "#f97316";
  if (
    lower.includes("clangd") ||
    lower.includes("cpp") ||
    lower.includes("c++") ||
    lower.includes("c/c++")
  )
    return "#06b6d4";
  if (lower.includes("gopls") || lower.includes("golang") || lower.includes("go "))
    return "#0ea5e9";
  if (lower.includes("vue")) return "#10b981";
  if (
    lower.includes("html") ||
    lower.includes("css") ||
    lower.includes("web") ||
    lower.includes("json")
  )
    return "#a855f7";
  if (lower.includes("markdown") || lower.includes("md")) return "#3b82f6";
  if (lower.includes("planner") || lower.includes("任务") || lower.includes("task"))
    return "#6366f1";
  if (
    lower.includes("typescript") ||
    lower.includes("javascript") ||
    lower.includes("js") ||
    lower.includes("ts")
  )
    return "#3b82f6";
  return "#60a5fa";
}

export function ExtensionIcon({
  icon,
  name = "Extension",
  size = 20,
  color,
  className = "",
}: ExtensionIconProps) {
  const [imageError, setImageError] = useState(false);
  const resolvedColor = color || getDefaultColorForName(name);

  // 1. 没有 icon 或加载失败时的智能 Fallback
  if (!icon || imageError) {
    const lower = name.toLowerCase();
    if (lower.includes("python") || lower.includes("pyright")) {
      return <Icons.FilePy size={size} style={{ color: resolvedColor }} className={className} />;
    }
    if (lower.includes("rust") || lower.includes("cargo")) {
      return <Icons.FileRust size={size} style={{ color: resolvedColor }} className={className} />;
    }
    if (
      lower.includes("clangd") ||
      lower.includes("cpp") ||
      lower.includes("c++") ||
      lower.includes("c/c++")
    ) {
      return <Icons.FileCpp size={size} style={{ color: resolvedColor }} className={className} />;
    }
    if (lower.includes("gopls") || lower.includes("golang") || lower.includes("go ")) {
      return <Icons.FileGo size={size} style={{ color: resolvedColor }} className={className} />;
    }
    if (lower.includes("vue")) {
      return <Icons.FileVue size={size} style={{ color: resolvedColor }} className={className} />;
    }
    if (
      lower.includes("html") ||
      lower.includes("css") ||
      lower.includes("web") ||
      lower.includes("json")
    ) {
      return <Icons.FileHtml size={size} style={{ color: resolvedColor }} className={className} />;
    }
    if (lower.includes("markdown") || lower.includes("md")) {
      return <Icons.FileMd size={size} style={{ color: resolvedColor }} className={className} />;
    }
    if (lower.includes("planner") || lower.includes("任务") || lower.includes("task")) {
      return <Icons.List size={size} style={{ color: resolvedColor }} className={className} />;
    }
    if (
      lower.includes("typescript") ||
      lower.includes("javascript") ||
      lower.includes("js") ||
      lower.includes("ts")
    ) {
      return <Icons.FileTs size={size} style={{ color: resolvedColor }} className={className} />;
    }
    return <Icons.Extensions size={size} style={{ color: resolvedColor }} className={className} />;
  }

  const trimmed = icon.trim();

  // 2. Tabler Icon 内置名格式 (例如 "tabler:sparkles", "tabler:code", "tabler:rust")
  if (trimmed.startsWith("tabler:") || TABLER_ICON_MAP[trimmed.toLowerCase()]) {
    const iconKey = trimmed.startsWith("tabler:")
      ? trimmed.slice(7).toLowerCase().trim()
      : trimmed.toLowerCase().trim();
    const renderFn = TABLER_ICON_MAP[iconKey];
    if (renderFn) {
      return (
        <span
          style={{ color: resolvedColor }}
          className="flex items-center justify-center shrink-0"
        >
          {renderFn(size, className)}
        </span>
      );
    }
  }

  // 3. 如果是以 <svg 开头的内联 SVG 字符串
  if (trimmed.startsWith("<svg") || (trimmed.startsWith("<") && trimmed.includes("</svg>"))) {
    return (
      <span
        style={{ width: size, height: size, color: resolvedColor }}
        className={`flex items-center justify-center shrink-0 [&>svg]:size-full [&>svg]:object-contain ${className}`}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: verified extension SVG
        dangerouslySetInnerHTML={{ __html: trimmed }}
      />
    );
  }

  // 4. 如果是图片 URL (http, https, data:image, 相对路径, 带有图片后缀等)
  return (
    <img
      src={trimmed}
      alt={name}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setImageError(true)}
      className={`shrink-0 rounded-control object-contain ${className}`}
    />
  );
}
