import { useMemo } from "react";

export interface ExtensionRenderState {
  html: string;
  diagnostics: string[];
  revision: number;
}

interface ExtensionViewHostProps {
  viewHtml: string;
  theme: string;
  renderState: ExtensionRenderState | null;
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

/**
 * 将扩展 AURX HTML 模板与宿主渲染数据组合
 *
 * 强制注入宿主实时主题属性 (data-theme) 与透明背景样式，
 * 杜绝任何浏览器默认 iframe 白底瑕疵。
 */
export function ExtensionViewHost({ viewHtml, theme, renderState }: ExtensionViewHostProps) {
  const composed = useMemo(() => {
    const html = renderState?.html ?? "";
    const diagnostics = renderState?.diagnostics ?? [];
    const status = diagnostics.length > 0 ? escapeHtml(diagnostics.join(" · ")) : "";
    const effectiveTheme = theme === "dark" ? "dark" : "light";

    // 1. 替换或注入 <html data-theme="..."> 属性
    let result = viewHtml;
    if (result.includes("<html")) {
      result = result.replace(/<html([^>]*)>/i, (_match, rest) => {
        // 清除旧的 data-theme 属性并注入最新值
        const cleaned = rest.replace(/data-theme=["'][^"']*["']/i, "").trim();
        return `<html ${cleaned} data-theme="${effectiveTheme}" style="color-scheme: ${effectiveTheme}; background: transparent;">`;
      });
    }

    // 2. 在 </head> 之前注入强制透明与色彩方案防御样式
    const transparentStyle = `<style>html, body { background: transparent !important; color-scheme: ${effectiveTheme}; }</style>`;
    if (result.includes("</head>")) {
      result = result.replace("</head>", `${transparentStyle}</head>`);
    } else {
      result = transparentStyle + result;
    }

    // 3. 填充渲染内容与状态条槽位
    return result.replace(RENDER_SLOT, html).replace(STATUS_SLOT, status);
  }, [viewHtml, theme, renderState]);

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
