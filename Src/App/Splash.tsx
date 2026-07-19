import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/righteous/400.css";
import "./Styles/Splash.css";
import { desktopApp, invokeDesktop } from "../Foundation/Desktop";

function SplashApp() {
  const [version, setVersion] = useState("...");

  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", preventContextMenu);

    // The splash window is visible from the native window configuration. Mark
    // the first React frame so Rust can keep the brand artwork visible for a
    // real two seconds without delaying window creation or image decoding.
    requestAnimationFrame(() => {
      invokeDesktop("mark_splashscreen_shown").catch(console.error);
    });

    desktopApp
      .getVersion()
      .then((v) => setVersion(`v${v}`))
      .catch(console.error);

    return () => document.removeEventListener("contextmenu", preventContextMenu);
  }, []);

  return (
    <div className="splash" data-tauri-drag-region="true">
      {/* Background Image: using the user's Monet painting */}
      <div className="splash__art" />

      {/* Subtle overlay gradient to ensure text readability against the beautiful Monet painting */}
      <div className="splash__overlay" data-tauri-drag-region="true" />

      {/* Top Left: Title */}
      <div className="splash__title">
        <h1>Aurona Code</h1>
      </div>

      <div className="splash__version">
        <span>{version}</span>
      </div>

      {/* Bottom Right: Spinner and Loading Text */}
      <div className="splash__loading">
        <span>准备进入创造模式</span>
        <svg
          aria-hidden="true"
          className="splash__spinner"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("SplashRoot") as HTMLElement).render(
  <React.StrictMode>
    <SplashApp />
  </React.StrictMode>,
);
