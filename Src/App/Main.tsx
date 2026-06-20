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
import "../Core/MonacoSetup";

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

    return () => {
      EventBus.off("app:reboot", onReboot);
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
