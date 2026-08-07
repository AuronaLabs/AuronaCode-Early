import { CommandRegistry } from "../Extension/CommandRegistry";
import { EventBus } from "../Foundation/EventBus";
import { LocaleService } from "../Foundation/I18n";
import type { AccountAuthPhase } from "../Foundation/IPC/AccountAuthCommands";
import { useWorkbenchStore } from "../State/useWorkspaceStore";
import { showToast } from "../UI/Feedback/Toast";
import { AccountService } from "./AccountService";

const PENDING_PHASES: AccountAuthPhase[] = [
  "discovering",
  "awaitingCallback",
  "exchangingCode",
  "refreshing",
];

function isBusy(): boolean {
  return PENDING_PHASES.includes(AccountService.getSnapshot().phase);
}

function openAccountSettings() {
  useWorkbenchStore.getState().openTab({ id: "settings", type: "settings", title: "设置" });
  EventBus.emit("settings:nav", "accountCloud");
}

export function registerAccountCommands(): () => void {
  const disposers = [
    CommandRegistry.register({
      id: "account.openSettings",
      title: "打开账户设置",
      category: "Aurona 账户",
      handler: openAccountSettings,
    }),
    CommandRegistry.register({
      id: "account.login",
      title: "登录 Aurona Account",
      category: "Aurona 账户",
      canExecute: () => {
        const status = AccountService.getSnapshot();
        return status.enabled && status.phase !== "signedIn" && !isBusy();
      },
      handler: async () => {
        const result = await AccountService.login();
        if (result.phase === "failed") {
          showToast(
            result.lastError?.userMessage ?? LocaleService.translate("account.loginFailed"),
            "error",
          );
        } else if (result.phase === "signedIn") {
          showToast(LocaleService.translate("account.loginToast"), "success");
        }
      },
    }),
    CommandRegistry.register({
      id: "account.logout",
      title: "退出登录",
      category: "Aurona 账户",
      canExecute: () => AccountService.getSnapshot().phase === "signedIn",
      handler: async () => {
        await AccountService.logout();
        showToast(LocaleService.translate("account.logoutToast"), "info");
      },
    }),
    CommandRegistry.register({
      id: "account.refreshProfile",
      title: "刷新账户资料",
      category: "Aurona 账户",
      canExecute: () => AccountService.getSnapshot().phase === "signedIn",
      handler: async () => {
        const result = await AccountService.refresh();
        if (result.phase === "failed") {
          showToast(
            result.lastError?.userMessage ?? LocaleService.translate("account.refreshFailed"),
            "error",
          );
        } else if (result.phase === "signedIn") {
          showToast(LocaleService.translate("account.refreshToast"), "success");
        }
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
