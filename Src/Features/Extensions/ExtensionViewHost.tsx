import { useMemo } from "react";
import { type DeclarativeUIRoot, isDeclarativeUI } from "../../Foundation/Types/ExtensionUI";
import { DeclarativeUIRenderer } from "./Declarative/DeclarativeUIRenderer";

export interface ExtensionRenderState {
  html: string;
  diagnostics: string[];
  revision: number;
}

interface ExtensionViewHostProps {
  viewHtml: string;
  theme: string;
  renderState: ExtensionRenderState | null;
  onAction?: (actionId: string, payload?: unknown) => void;
}

const RENDER_SLOT = "<!--AURONA_RENDER_SLOT-->";
const STATUS_SLOT = "<!--AURONA_STATUS_SLOT-->";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tryParseDeclarativeUI(raw: string): DeclarativeUIRoot | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (isDeclarativeUI(parsed)) {
      return parsed;
    }
  } catch {
    // 不是有效 JSON
  }
  return null;
}

/**
 * 统一扩展视图宿主：支持【官方原生声明式组件】与【自定义 Webview 容器】双模自适应渲染
 */
export function ExtensionViewHost({
  viewHtml,
  theme,
  renderState,
  onAction,
}: ExtensionViewHostProps) {
  // 1. 检查是否为模式 A：官方原生声明式组件 (Declarative UI)
  const declarativeUI = useMemo(() => {
    if (renderState?.html) {
      const parsed = tryParseDeclarativeUI(renderState.html);
      if (parsed) return parsed;
    }
    return tryParseDeclarativeUI(viewHtml);
  }, [renderState?.html, viewHtml]);

  // 2. 模式 B：自定义 Webview 容器 (Custom Webview Host)
  const composed = useMemo(() => {
    if (declarativeUI) return "";
    const html = renderState?.html ?? "";
    const diagnostics = renderState?.diagnostics ?? [];
    const status = diagnostics.length > 0 ? escapeHtml(diagnostics.join(" · ")) : "";
    const effectiveTheme = theme === "dark" ? "dark" : "light";

    let result = viewHtml;
    if (result.includes("<html")) {
      result = result.replace(/<html([^>]*)>/i, (_match, rest) => {
        const cleaned = rest.replace(/data-theme=["'][^"']*["']/i, "").trim();
        return `<html ${cleaned} data-theme="${effectiveTheme}" style="color-scheme: ${effectiveTheme}; background: transparent;">`;
      });
    }

    const transparentStyle = `<style>html, body { background: transparent !important; color-scheme: ${effectiveTheme}; }</style>`;
    if (result.includes("</head>")) {
      result = result.replace("</head>", `${transparentStyle}</head>`);
    } else {
      result = transparentStyle + result;
    }

    return result.replace(RENDER_SLOT, html).replace(STATUS_SLOT, status);
  }, [declarativeUI, viewHtml, theme, renderState]);

  // 如果是官方原生声明式组件模式，直接由 React 现代玻璃组件树驱动渲染
  if (declarativeUI) {
    return (
      <div className="h-full w-full overflow-y-auto overflow-x-hidden bg-transparent">
        <DeclarativeUIRenderer ui={declarativeUI} onAction={onAction} />
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useIframeTitle: sandboxed plugin frame uses aria-label; native title is forbidden by the material boundary
    <iframe
      sandbox=""
      srcDoc={composed}
      aria-label="extension-view"
      onContextMenu={(e) => e.preventDefault()}
      className="h-full w-full border-0 bg-transparent"
    />
  );
}
