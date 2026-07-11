import type React from "react";
import { useEffect, useState } from "react";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";

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
  const [ready, setReady] = useState(false);
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

        const savedEditorFont = userConfig.editorFontSize?.toString() || "14";
        const savedTerminalFont = userConfig.terminalFontSize?.toString() || "13";
        document.documentElement.style.setProperty("--EditorFontSize", `${savedEditorFont}px`);
        document.documentElement.style.setProperty("--TerminalFontSize", `${savedTerminalFont}px`);

        // Load workspace in parallel
        await WorkspaceStore.init();

        if (!mounted) return;

        // Force a minimum load time of 2000ms from initialization start.
        // Because React takes ~500ms to mount before the splash window shows,
        // this guarantees the splash window is VISIBLE for at least ~1.5s!
        const elapsed = performance.now() - startTime;
        const waitTime = Math.max(0, 2000 - elapsed);

        setTimeout(() => {
          if (!mounted) return;

          setReady(true);

          // Once we are completely ready, tell the Rust backend to close the splashscreen.
          // The Rust backend will also show and maximize the main window safely!
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("close_splashscreen").catch(console.error);
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
        UserConfigStore.get().then((config) => {
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

  // We only render children once the bootstrapping is fully complete.
  // This ensures the main window is rendered with its full DOM tree before it becomes visible!
  return <>{ready ? children : null}</>;
}
