import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./Styles/Theme.css";
import "@fontsource/righteous";
import "harmonyos-sans-sc-webfont-splitted";
import { ErrorBoundary } from "../Layout/ErrorBoundary";
import { AppBootstrapper } from "../Core/AppBootstrapper";
import { EventBus } from "../Core/EventBus";
import { Logger } from "../Core/Logger";

Logger.init();

function RootApp() {
  const [bootKey, setBootKey] = React.useState(0);

  useEffect(() => {
    // Remove the HTML loading spinner to show the react app (handled smoothly by Bootstrapper now)
    document.getElementById('app-loader')?.remove();

    // Reveal window after the component mounts
    getCurrentWindow().show();

    // Listen for soft reboot requests
    const onReboot = () => {
      setBootKey(prev => prev + 1);
    };

    EventBus.on("app:reboot", onReboot);

    // Global Keydown Interceptor to prevent default browser behaviors
    const onKeyDown = (e: KeyboardEvent) => {
      // Allow DevTools in dev mode (Ctrl+Shift+I or F12)
      if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) {
        return;
      }
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;
      
      const preventKeys = [
        { ctrl: true, shift: false, key: 'p' }, // Print
        { ctrl: true, shift: false, key: 'r' }, // Reload
        { ctrl: false, shift: false, key: 'f5' }, // Reload
        { ctrl: true, shift: true, key: 'r' }, // Hard Reload
        { ctrl: true, shift: false, key: 's' }, // Save page
      ];
      
      const shouldPrevent = preventKeys.some(k => 
        (k.ctrl === cmdKey) && 
        (k.shift === e.shiftKey) &&
        (e.key.toLowerCase() === k.key.toLowerCase())
      );
      
      if (shouldPrevent) {
        e.preventDefault();
        
        if (cmdKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
          // Prepare for Command Palette
          // EventBus.emit("app:command-palette");
          console.log("Ctrl+P intercepted for Command Palette");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      EventBus.off("app:reboot", onReboot);
      window.removeEventListener("keydown", onKeyDown);
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
