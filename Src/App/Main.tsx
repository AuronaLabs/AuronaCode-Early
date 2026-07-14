
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./Styles/Theme.css";
import "@fontsource/righteous";
import "@fontsource/jetbrains-mono";
import "harmonyos-sans-sc-webfont-splitted";
import { AppBootstrapper } from "../Core/AppBootstrapper";
import { EventBus } from "../Foundation/EventBus";
import { Logger } from "../Foundation/Logger";
import { ErrorBoundary } from "../Layout/ErrorBoundary";

Logger.init();

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
        e.key === "F12" ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "i");

      if (isDevtoolsShortcut) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

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

        if (cmdKey && !e.shiftKey && e.key.toLowerCase() === "p") {
          console.log("Ctrl+P intercepted for Command Palette");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });

    return () => {
      EventBus.off("app:reboot", onReboot);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
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
