import type React from "react";
import { useEffect, useState } from "react";
import { OobeOverlay } from "../App/Oobe";
import { useOobeStore } from "../App/Oobe/useOobeStore";
import { applyAccentTheme, applyLiquidTexture } from "../App/ThemeAccent";
import { desktopWindow } from "../Foundation/Desktop";
import { applyPersistedLocale } from "../Foundation/I18n";
import { AppLifecycleIPC } from "../Foundation/IPC/AppLifecycleCommands";
import { NetworkIPC } from "../Foundation/IPC/NetworkCommands";
import { StorageIPC } from "../Foundation/IPC/StorageCommands";
import { PlatformService } from "../Foundation/Platform";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import { setPathPlatform } from "../Shared/Utils/UriUtils";
import { AppServices } from "./AppServices";
import { restoreWindowLayout } from "./WindowLayoutManager";

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
        // 平台探测与用户配置读取互不依赖，并行执行以缩短启动关键路径
        await Promise.all([PlatformService.initialize(), UserConfigStore.init()]);
        setPathPlatform(PlatformService.current());

        const userConfig = await UserConfigStore.get();

        // 语言以 UserConfig 为真源，启动时校正 localStorage 快照（首帧已用快照渲染，晚于此处）
        applyPersistedLocale(userConfig.locale);

        // 首次运行判定直接复用配置读取结果（首次加载即无 user-config.json），
        // 覆盖层在 ready 后随工作台同帧挂载，底层工作台并行启动不受阻塞。
        if (!mounted) return;
        if (UserConfigStore.isFirstRun()) {
          useOobeStore.getState().open("first-run");
        }

        // 同步退出清理开关到 Rust 侧（默认开启），窗口全部销毁后据此清理 WebView 缓存；
        // 非关键路径，落盘失败静默
        void StorageIPC.setExitCleanupEnabled(userConfig.cleanup?.clearCacheOnExit !== false).catch(
          () => undefined,
        );

        // 同步代理偏好到 Rust 侧全局状态（工具链下载使用；更新检查由 UpdaterService 按 check 选项直传）
        void NetworkIPC.setNetworkProxy(
          userConfig.network?.proxyMode ?? "system",
          userConfig.network?.proxyUrl,
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
        // 单层 rAF：等待一帧渲染完成后即记录指标并关闭 Splash
        requestAnimationFrame(async () => {
          if (!mounted) return;
          // 主窗口此刻仍不可见：首启最大化 / 恢复上次布局都在 show 之前完成，避免尺寸变化闪烁
          try {
            if (UserConfigStore.isFirstRun()) {
              await desktopWindow.maximize();
            } else if (userConfig.windowState) {
              await restoreWindowLayout(userConfig.windowState);
            }
          } catch (error) {
            console.warn("Window layout restore failed", error);
          }
          const mainInteractiveMs = performance.now() - startTime;
          void AppLifecycleIPC.recordStartupMetrics({
            frontendBootstrapMs: elapsed,
            mainInteractiveMs,
            splashMinimumMs: 2_000,
          })
            .catch(console.error)
            .finally(() => AppLifecycleIPC.closeSplashscreen().catch(console.error));
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
  // OOBE 覆盖层同样等待 ready：Splash 关闭后与工作台同帧挂载，避免遮罩下出现空白闪现。
  return (
    <>
      {ready ? children : null}
      {ready && oobeMode ? <OobeOverlay /> : null}
    </>
  );
}
