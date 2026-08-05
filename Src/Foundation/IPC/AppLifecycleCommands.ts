import { invokeDesktop } from "../Desktop";

export interface StartupMetricsInput {
  frontendBootstrapMs: number;
  mainInteractiveMs: number;
  splashMinimumMs: number;
}

export const AppLifecycleIPC = {
  markSplashscreenShown: () => invokeDesktop<void>("mark_splashscreen_shown"),
  closeSplashscreen: () => invokeDesktop<void>("close_splashscreen"),
  recordStartupMetrics: (input: StartupMetricsInput) =>
    invokeDesktop<void>("record_startup_metrics", { input }),
  openDevtools: () => invokeDesktop<void>("open_devtools"),
};
