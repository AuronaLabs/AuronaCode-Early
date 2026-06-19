import React, { useEffect, useState } from "react";
import { StorageManager } from "./StorageManager";

interface Props {
  children: React.ReactNode;
}

const applyResponsiveDensity = () => {
  const root = document.documentElement;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  if (width < 940 || height < 680 || dpr >= 1.75) {
    root.dataset.density = "compact";
  } else if (width > 1600 && height > 900 && dpr <= 1.25) {
    root.dataset.density = "comfortable";
  } else {
    root.dataset.density = "regular";
  }
};

const BOOT_MESSAGES = [
  "正在前往 Aurona Code 的路上",
  "整理工作台，马上就好",
  "路上有点堵，正在绕开",
  "唤醒编辑器引擎",
  "把文件树扶正一点",
  "检查今天的灵感缓存",
  "Aurona Code 即将抵达",
];

export function AppBootstrapper({ children }: Props) {
  const [status, setStatus] = useState<"initializing" | "ready">("initializing");
  const [fade, setFade] = useState(false);
  const [initError, setInitError] = useState<Error | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);

  if (initError) throw initError;

  useEffect(() => {
    applyResponsiveDensity();
    window.addEventListener("resize", applyResponsiveDensity);
    return () => window.removeEventListener("resize", applyResponsiveDensity);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % BOOT_MESSAGES.length);
    }, 1200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initializeCoreServices() {
      try {
        const savedTheme = localStorage.getItem("aurona-theme") || "system";
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (savedTheme === "dark" || (savedTheme === "system" && prefersDark)) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }

        const initPromise = Promise.all([StorageManager.init()]);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("启动引擎超时。请检查 Tauri IPC 或系统资源占用。")), 5000),
        );

        await Promise.race([initPromise, timeoutPromise]);
        if (!mounted) return;

        setTimeout(() => {
          if (!mounted) return;
          setFade(true);
          setTimeout(() => {
            if (mounted) setStatus("ready");
          }, 180);
        }, 120);
      } catch (error) {
        if (mounted) {
          setInitError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }

    initializeCoreServices();

    return () => {
      mounted = false;
    };
  }, []);

  if (status === "initializing") {
    return (
      <div
        className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-[var(--ColorApp)] transition-opacity duration-300 select-none ${fade ? "opacity-0" : "opacity-100"}`}
      >
        <svg className="w-11 h-11 mb-6 animate-spin text-[var(--ColorAccent)]" viewBox="0 0 50 50">
          <circle className="stroke-current" cx="25" cy="25" r="20" fill="none" strokeWidth="8" strokeLinecap="round" strokeDasharray="90, 150" />
        </svg>
        <div className="h-6 overflow-hidden text-slate-500 text-sm font-medium">
          <div className="transition-transform duration-500 ease-out" style={{ transform: `translateY(-${messageIndex * 1.5}rem)` }}>
            {BOOT_MESSAGES.map((message) => (
              <div key={message} className="h-6 flex items-center justify-center whitespace-nowrap">
                {message}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
