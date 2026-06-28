import React, { useEffect, useState } from "react";
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";

interface Props {
  children: React.ReactNode;
}

const applyResponsiveDensity = (density?: "compact" | "default" | "comfortable") => {
  const root = document.documentElement;
  if (density && density !== "default") {
    root.dataset.density = density;
    return;
  }
  
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

export function AppBootstrapper({ children }: Props) {
  const [status, setStatus] = useState<"initializing" | "ready">("initializing");
  const [fade, setFade] = useState(false);
  const [initError, setInitError] = useState<Error | null>(null);

  if (initError) throw initError;

  useEffect(() => {
    let mounted = true;

    async function initializeCoreServices() {
      const startTime = performance.now();
      try {
        await UserConfigStore.init();
        const userConfig = await UserConfigStore.get();
        
        const savedTheme = userConfig.theme || "system";
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (savedTheme === "dark" || (savedTheme === "system" && prefersDark)) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
        
        applyResponsiveDensity(userConfig.density);

        // Apply Editor and Terminal font sizes
        const savedEditorFont = userConfig.editorFontSize?.toString() || "14";
        const savedTerminalFont = userConfig.terminalFontSize?.toString() || "13";
        document.documentElement.style.setProperty("--EditorFontSize", `${savedEditorFont}px`);
        document.documentElement.style.setProperty("--TerminalFontSize", `${savedTerminalFont}px`);

        const initPromise = Promise.all([WorkspaceStore.init()]);
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

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        UserConfigStore.get().then(config => {
          applyResponsiveDensity(config.density);
        });
      }, 150);
    };
    
    window.addEventListener("resize", handleResize);
    return () => {
      mounted = false;
      window.removeEventListener("resize", handleResize);
      if (resizeTimer) clearTimeout(resizeTimer);
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
