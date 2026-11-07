import { sanitizeExtensionDocument } from "../../../Foundation/Security/ExtensionContent";
import { extensionThemeStyle, type ThemeSnapshot } from "../../../Foundation/Theme/ThemeSnapshot";
import { type DeclarativeUIRoot, isDeclarativeUI } from "../../../Foundation/Types/ExtensionUI";

export interface ExtensionRenderState {
  html: string;
  diagnostics: string[];
  revision: number;
}
export function tryParseDeclarativeUI(raw: string): DeclarativeUIRoot | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const value = JSON.parse(trimmed);
    return isDeclarativeUI(value) ? value : null;
  } catch {
    return null;
  }
}
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function composeExtensionDocument(
  view: string,
  render: ExtensionRenderState | null,
  theme: ThemeSnapshot,
): string {
  const source = view
    .replace("<!--AURONA_RENDER_SLOT-->", render?.html ?? "")
    .replace("<!--AURONA_STATUS_SLOT-->", escapeHtml(render?.diagnostics.join(" · ") ?? ""));
  const document = new DOMParser().parseFromString(source, "text/html");
  document.documentElement.dataset.theme = theme.mode;
  const style = document.createElement("style");
  style.textContent = extensionThemeStyle(theme);
  document.head.append(style);
  return sanitizeExtensionDocument(`<!doctype html>${document.documentElement.outerHTML}`);
}
