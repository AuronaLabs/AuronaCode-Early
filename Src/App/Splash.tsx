import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./Styles/Theme.css";
import "@fontsource/righteous";
import "harmonyos-sans-sc-webfont-splitted";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";

function SplashApp() {
  const [version, setVersion] = useState("...");

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(`v${v}`))
      .catch(console.error);

    const applyTheme = (theme: "light" | "dark" | "system") => {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const isDark = theme === "dark" || (theme === "system" && prefersDark);
      if (isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };
    applyTheme("system");
    UserConfigStore.get()
      .then((config) => applyTheme(config.theme || "system"))
      .catch(console.error);

    // Preload the Monet image before showing the window.
    // This ensures that when the window appears, the image is already fully decoded and painted,
    // completely eliminating the "black flash" or sudden loading effect.
    const img = new Image();
    img.src = "/splash.webp";
    const showWindow = () => {
      requestAnimationFrame(() => {
        getCurrentWindow().show().catch(console.error);
      });
    };
    img.onload = showWindow;
    img.onerror = showWindow; // Fallback in case of error
  }, []);

  return (
    <div
      className="w-screen h-screen relative overflow-hidden select-none bg-black"
      data-tauri-drag-region="true"
    >
      {/* Background Image: using the user's Monet painting */}
      <div
        className="absolute inset-0 z-0 pointer-events-none bg-cover bg-center"
        style={{ backgroundImage: "url('/splash.webp')" }}
      ></div>

      {/* Subtle overlay gradient to ensure text readability against the beautiful Monet painting */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.6) 100%)",
        }}
        data-tauri-drag-region="true"
      ></div>

      {/* Top Left: Title */}
      <div className="absolute top-8 left-8 z-10 pointer-events-none">
        <h1
          className="text-[32px] text-white tracking-[0.05em] m-0 drop-shadow-lg font-bold"
          style={{ fontFamily: "'Righteous', sans-serif" }}
        >
          Aurona Code
        </h1>
      </div>

      <div className="absolute bottom-8 left-8 z-10 pointer-events-none">
        <span className="text-[14px] text-gray-200 font-mono font-medium tracking-wider opacity-90 drop-shadow-md">
          {version}
        </span>
      </div>

      {/* Bottom Right: Spinner and Loading Text */}
      <div className="absolute bottom-8 right-8 z-10 flex items-center gap-3 pointer-events-none drop-shadow-md">
        <span className="text-[14px] text-white font-medium tracking-wide">准备进入创造模式</span>
        <svg
          className="w-5 h-5 text-white animate-spin drop-shadow-lg"
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
