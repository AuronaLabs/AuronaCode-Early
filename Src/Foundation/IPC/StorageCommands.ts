import { invokeDesktop } from "../Desktop";

export const StorageIPC = {
  getBreakdown: <T>() => invokeDesktop<T>("get_storage_breakdown"),
  openAppDataFolder: () => invokeDesktop<void>("open_app_data_folder"),
  clearExtensionStorage: () => invokeDesktop<number>("clear_extension_storage"),
  clearOtherAppData: () => invokeDesktop<void>("clear_other_app_data"),
  clearEditorRecovery: () => invokeDesktop<void>("clear_editor_recovery"),
  clearAppLogs: () => invokeDesktop<void>("clear_app_logs"),
  clearErrLogs: () => invokeDesktop<void>("clear_err_logs"),
  clearWebviewCache: () => invokeDesktop<void>("clear_webview_cache"),
  clearPerformanceBaseline: () => invokeDesktop<void>("clear_performance_baseline"),
  clearToolchains: () => invokeDesktop<number>("clear_toolchains"),
};
