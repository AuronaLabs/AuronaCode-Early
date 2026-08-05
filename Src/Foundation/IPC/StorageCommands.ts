import { invokeDesktop } from "../Desktop";

export const StorageIPC = {
  getBreakdown: <T>() => invokeDesktop<T>("get_storage_breakdown"),
  clearOtherAppData: () => invokeDesktop<void>("clear_other_app_data"),
  clearEditorRecovery: () => invokeDesktop<void>("clear_editor_recovery"),
  clearAppLogs: () => invokeDesktop<void>("clear_app_logs"),
  clearErrLogs: () => invokeDesktop<void>("clear_err_logs"),
  clearWebviewCache: () => invokeDesktop<void>("clear_webview_cache"),
  clearPerformanceBaseline: () => invokeDesktop<void>("clear_performance_baseline"),
};
