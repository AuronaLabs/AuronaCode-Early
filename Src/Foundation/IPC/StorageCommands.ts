import { invokeDesktop } from "../Desktop";

export const StorageIPC = {
  getBreakdown: <T>() => invokeDesktop<T>("get_storage_breakdown"),
  clearOtherAppData: () => invokeDesktop<void>("clear_other_app_data"),
  clearEditorRecovery: () => invokeDesktop<void>("clear_editor_recovery"),
  clearAppLogs: () => invokeDesktop<void>("clear_app_logs"),
};
