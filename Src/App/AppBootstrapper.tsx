import type React from "react";
import { useEffect, useState } from "react";
import { restoreWindowLayout } from "../Core/WindowLayoutManager";
import { desktopWindow } from "../Foundation/Desktop";
import { applyPersistedLocale } from "../Foundation/I18n";
import { AppLifecycleIPC } from "../Foundation/IPC/AppLifecycleCommands";
import { NetworkIPC } from "../Foundation/IPC/NetworkCommands";
import { StorageIPC } from "../Foundation/IPC/StorageCommands";
import { PlatformService } from "../Foundation/Platform";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import { setPathPlatform } from "../Shared/Utils/UriUtils";
import { AppServices } from "./AppServices";
import { applyUserAppearance } from "./Bootstrap/AppearanceController";
import { OobeOverlay } from "./Oobe";
import { useOobeStore } from "./Oobe/useOobeStore";
import { WorkspaceApproval } from "./WorkspaceApproval";

interface Props {
  children: React.ReactNode;
}

export function AppBootstrapper({ children }: Props) {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
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

        applyUserAppearance(userConfig);

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
          }).catch(console.error);
          await AppLifecycleIPC.closeSplashscreen();
          if (mounted) setVisible(true);
        });
      } catch (error) {
        if (mounted) {
          setInitError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }

    initializeCoreServices();

    return () => {
      mounted = false;
      AppServices.dispose();
    };
  }, []);

  // We only render children once the bootstrapping is fully complete.
  // This ensures the main window is rendered with its full DOM tree before it becomes visible!
  // OOBE 覆盖层同样等待 ready：Splash 关闭后与工作台同帧挂载，避免遮罩下出现空白闪现。
  return (
    <>
      {ready ? children : null}
      {ready && <WorkspaceApproval visible={visible} />}
      {ready && oobeMode ? <OobeOverlay /> : null}
    </>
  );
}
