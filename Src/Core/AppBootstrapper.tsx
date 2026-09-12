import type React from "react";
import { useEffect, useState } from "react";
import { OobeOverlay } from "../App/Oobe";
import { useOobeStore } from "../App/Oobe/useOobeStore";
import { applyAccentTheme, applyLiquidTexture } from "../App/ThemeAccent";
import { BaseDirectory, desktopFileSystem } from "../Foundation/Desktop";
import { AppLifecycleIPC } from "../Foundation/IPC/AppLifecycleCommands";
import { StorageIPC } from "../Foundation/IPC/StorageCommands";
import { PlatformService } from "../Foundation/Platform";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import { setPathPlatform } from "../Shared/Utils/UriUtils";
import { AppServices } from "./AppServices";

interface Props {
  children: React.ReactNode;
}

const applyResponsiveDensity = (density?: "compact" | "default" | "regular" | "comfortable") => {
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
  const oobeMode = useOobeStore((state) => state.mode);

  if (initError) throw initError;

  useEffect(() => {
    let mounted = true;

    async function initializeCoreServices() {
      const startTime = performance.now();
      try {
        await PlatformService.initialize();
        setPathPlatform(PlatformService.current());
        await UserConfigStore.init();

        // 首次运行（尚无 user-config.json）：准备欢迎引导覆盖层。
        // 覆盖层在 Splash 关闭、主窗口显示后就绪即呈现，底层工作台并行启动不受阻塞。
        const configExists = await desktopFileSystem
          .exists("user-config.json", { baseDir: BaseDirectory.AppLocalData })
          .catch(() => true);
        if (!mounted) return;
        if (!configExists) {
          useOobeStore.getState().open("first-run");
        }

        const userConfig = await UserConfigStore.get();

        // 同步退出清理开关到 Rust 侧（默认开启），窗口全部销毁后据此清理 WebView 缓存
        await StorageIPC.setExitCleanupEnabled(
          userConfig.cleanup?.clearCacheOnExit !== false,
        ).catch(() => undefined);

        const savedTheme = userConfig.theme || "system";
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (savedTheme === "dark" || (savedTheme === "system" && prefersDark)) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }

        applyAccentTheme(userConfig.accentTheme);
        applyLiquidTexture(userConfig.liquidTexture ?? false);
        applyResponsiveDensity(userConfig.density);

        if (userConfig.boldText) {
          document.documentElement.setAttribute("data-bold-text", "true");
        } else {
          document.documentElement.removeAttribute("data-bold-text");
        }

        if (userConfig.interfaceFontSize && userConfig.interfaceFontSize !== "default") {
          document.documentElement.setAttribute("data-font-size", userConfig.interfaceFontSize);
        } else {
          document.documentElement.removeAttribute("data-font-size");
        }

        const savedEditorFont = userConfig.editorFontSize?.toString() || "14";
        const savedEditorLineHeight = userConfig.editorLineHeight?.toString() || "24";
        const savedEditorTabSize = userConfig.editorTabSize?.toString() || "2";
        const savedTerminalFont = userConfig.terminalFontSize?.toString() || "13";
        document.documentElement.style.setProperty("--EditorFontSize", `${savedEditorFont}px`);
        document.documentElement.style.setProperty(
          "--EditorLineHeight",
          `${savedEditorLineHeight}px`,
        );
        document.documentElement.style.setProperty("--EditorTabSize", savedEditorTabSize);
        document.documentElement.style.setProperty("--TerminalFontSize", `${savedTerminalFont}px`);

        await AppServices.start();

        if (!mounted) return;

        const elapsed = performance.now() - startTime;
        setReady(true);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!mounted) return;
            const mainInteractiveMs = performance.now() - startTime;
            void AppLifecycleIPC.recordStartupMetrics({
              frontendBootstrapMs: elapsed,
              mainInteractiveMs,
              splashMinimumMs: 2_000,
            })
              .catch(console.error)
              .finally(() => AppLifecycleIPC.closeSplashscreen().catch(console.error));
          });
        });
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
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      UserConfigStore.get().then((config) => {
        if (config.theme !== "system") return;
        document.documentElement.classList.toggle("dark", mediaQuery.matches);
      });
    };
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => {
      mounted = false;
      AppServices.dispose();
      window.removeEventListener("resize", handleResize);
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, []);

  // We only render children once the bootstrapping is fully complete.
  // This ensures the main window is rendered with its full DOM tree before it becomes visible!
  return (
    <>
      {ready ? children : null}
      {oobeMode && <OobeOverlay />}
    </>
  );
}
