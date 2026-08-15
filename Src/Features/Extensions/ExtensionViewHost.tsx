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
const THEME_ATTRIBUTE = 'data-theme="light"';

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Composes the plugin-owned view document from its AURX HTML template.
 *
 * The main WebView CSP (`script-src 'self'`) is inherited by srcdoc frames, so
 * inline plugin scripts are blocked. V1 therefore assembles rendered content
 * into the template on the host side and never relies on scripts inside the
 * frame; the frame stays fully sandboxed (`sandbox=""`).
 */
export function ExtensionViewHost({ viewHtml, theme, renderState }: ExtensionViewHostProps) {
  const composed = useMemo(() => {
    const html = renderState?.html ?? "";
    const diagnostics = renderState?.diagnostics ?? [];
    const status = diagnostics.length > 0 ? escapeHtml(diagnostics.join(" · ")) : "";
    const themeReplacement = theme === "dark" ? 'data-theme="dark"' : THEME_ATTRIBUTE;
    return viewHtml
      .replace(THEME_ATTRIBUTE, themeReplacement)
      .replace(RENDER_SLOT, html)
      .replace(STATUS_SLOT, status);
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
