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

  if (initError) throw initError;

  useEffect(() => {
    applyResponsiveDensity();
    window.addEventListener("resize", applyResponsiveDensity);
    return () => window.removeEventListener("resize", applyResponsiveDensity);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initializeCoreServices() {
      const startTime = performance.now();
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
          setTimeout(() => reject(new Error("启动引擎超时 请检查 Tauri IPC 或系统资源占用")), 5000),
        );

        await Promise.race([initPromise, timeoutPromise]);
        if (!mounted) return;

        const elapsed = performance.now() - startTime;
        const waitTime = Math.max(0, 1000 - elapsed);

        setTimeout(() => {
          if (!mounted) return;
          
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!mounted) return;
              setFade(true);
              setTimeout(() => {
                if (mounted) setStatus("ready");
              }, 700); // 700ms wait for the new scale/blur transition
            });
          });
        }, waitTime);
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

  return (
    <>
      {status === "initializing" && (
        <div
          className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-[var(--ColorApp)] select-none"
          style={{
            opacity: fade ? 0 : 1,
            transition: "opacity 0.4s ease-out",
            pointerEvents: fade ? "none" : "auto"
          }}
        >
          <svg className="w-11 h-11 mb-6 animate-spin text-[var(--ColorAccent)]" viewBox="0 0 50 50">
            <circle className="stroke-current" cx="25" cy="25" r="20" fill="none" strokeWidth="8" strokeLinecap="round" strokeDasharray="90, 150" />
          </svg>
          <div className="h-6 overflow-hidden text-slate-500 text-sm font-medium">
            <div className="h-6 flex items-center justify-center whitespace-nowrap">
              正在前往 Aurona Code 的路上
            </div>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
