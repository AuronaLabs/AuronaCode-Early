import {
  composeExtensionDocument,
  type ExtensionRenderState,
  tryParseDeclarativeUI,
} from "../../Core/Extensions/Views/ExtensionViewDocument";
import { useThemeSnapshot } from "../../UI/Core/useThemeSnapshot";

export type { ExtensionRenderState } from "../../Core/Extensions/Views/ExtensionViewDocument";

import { useMemo } from "react";
import { CompatWebview } from "./CompatWebview";
import { DeclarativeUIRenderer } from "./Declarative/DeclarativeUIRenderer";

interface ExtensionViewHostProps {
  viewHtml: string;
  theme: string;
  accentColor: string;
  fontSize: string;
  fontWeight: string;
  renderState: ExtensionRenderState | null;
  onAction?: (actionId: string, payload?: unknown) => void | Promise<void>;
}

/**
 * 统一扩展视图宿主：支持【官方原生声明式组件】与【自定义 Webview 容器】双模自适应渲染
 */
export function ExtensionViewHost({
  viewHtml,
  theme,
  accentColor,
  fontSize,
  fontWeight,
  renderState,
  onAction,
}: ExtensionViewHostProps) {
  const snapshot = useThemeSnapshot(theme, accentColor, fontSize, fontWeight);
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
    return composeExtensionDocument(viewHtml, renderState, snapshot);
  }, [declarativeUI, viewHtml, renderState, snapshot]);

  // 如果是官方原生声明式组件模式，直接由 React 现代玻璃组件树驱动渲染
  if (declarativeUI) {
    return (
      <div className="h-full w-full overflow-y-auto overflow-x-hidden bg-transparent">
        <DeclarativeUIRenderer ui={declarativeUI} onAction={onAction} />
        {declarativeUI.webviews
          ?.slice(0, 8)
          .filter(
            (panel) =>
              typeof panel.id === "string" &&
              typeof panel.title === "string" &&
              typeof panel.html === "string" &&
              Array.isArray(panel.messages),
          )
          .map((panel) => (
            <CompatWebview key={panel.id} panel={panel} theme={theme} onAction={onAction} />
          ))}
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
