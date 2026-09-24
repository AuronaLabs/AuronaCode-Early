import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./Styles/tokens.css";
import "./Styles/materials.css";
import "./Styles/components.css";
import "./Styles/editor-syntax.css";
import "@fontsource/righteous";
import "@fontsource/jetbrains-mono";
import { AppBootstrapper } from "../Core/AppBootstrapper";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { EventBus } from "../Foundation/EventBus";
import { Logger } from "../Foundation/Logger";
import { PlatformService } from "../Foundation/Platform";
import { ErrorBoundary } from "../Layout/ErrorBoundary";

Logger.init();

// 超椭圆圆角（corner-shape）能力探测：便于排查是否命中渐进增强
Logger.info(
  `corner-shape supported: ${CSS.supports?.("corner-shape", "superellipse(3)") ?? false}`,
);

function RootApp() {
  const [bootKey, setBootKey] = React.useState(0);

  useEffect(() => {
    // Splash screen close logic is now handled in AppBootstrapper.tsx

    const onReboot = () => {
      setBootKey((prev) => prev + 1);
    };

    EventBus.on("app:reboot", onReboot);

    const onKeyDown = (e: KeyboardEvent) => {
      const isDevtoolsShortcut =
        e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "i");

      if (isDevtoolsShortcut) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (CommandRegistry.handleKeyDown(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const cmdKey = PlatformService.isMacOS() ? e.metaKey : e.ctrlKey;

      const preventKeys = [
        { ctrl: true, shift: false, key: "p" },
        { ctrl: true, shift: false, key: "r" },
        { ctrl: false, shift: false, key: "f5" },
        { ctrl: true, shift: true, key: "r" },
        { ctrl: true, shift: false, key: "s" },
      ];

      const shouldPrevent = preventKeys.some(
        (k) =>
          k.ctrl === cmdKey &&
          k.shift === e.shiftKey &&
          e.key.toLowerCase() === k.key.toLowerCase(),
      );

      if (shouldPrevent) {
        e.preventDefault();
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      // 阻止 webview 浏览器默认右键菜单（在冒泡阶段阻止，允许 Radix UI ContextMenu 正常捕获）
      e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("contextmenu", onContextMenu);

    return () => {
      EventBus.off("app:reboot", onReboot);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  return (
    <ErrorBoundary key={bootKey}>
      <AppBootstrapper>
        <App />
      </AppBootstrapper>
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById("Root") as HTMLElement).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);
