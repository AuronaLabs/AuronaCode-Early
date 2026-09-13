import { desktopWindow } from "../Foundation/Desktop";
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";
import { initializeEditorStore } from "../State/useEditorStore";
import { initializeTerminalStore } from "../State/useTerminalStore";
import { initializeWorkbenchStore } from "../State/useWorkspaceStore";
import { AccountService } from "./AccountService";
import { registerWorkbenchCommands } from "./Commands";
import { DebugService } from "./DebugService";
import { DocumentService } from "./DocumentService";
import { LspClient } from "./Language/LspClient";
import { OutputService } from "./OutputService";
import { RecoveryCoordinator } from "./Recovery/RecoveryCoordinator";
import { WorkspaceService } from "./WorkspaceService";

let startPromise: Promise<void> | null = null;
let disposers: (() => void)[] = [];
let shouldBeStarted = false;

async function initializeCloseProtection(): Promise<() => void> {
  let destroying = false;
  const unlisten = await desktopWindow.onCloseRequested(async (event) => {
    if (destroying) return;
    event.preventDefault();
    await RecoveryCoordinator.flushAll();
    await DocumentService.closeAll(true);
    await LspClient.shutdownCurrent();
    await AccountService.shutdown().catch(() => undefined);
    destroying = true;
    await desktopWindow.destroy();
  });
  return unlisten;
}

/**
 * 账号会话恢复不在启动关键路径上：restore→refresh→discover 在弱网下可达 30s 超时，
 * 阻塞它会导致 Splash 空转。改为后台执行，登录态由各页面自行订阅账户状态。
 */
async function restoreAccountSessionInBackground(): Promise<void> {
  try {
    await AccountService.initialize();
  } catch (error) {
    console.warn("Account session restore failed; user stays signed out", error);
  }
}

export const AppServices = {
  async start(): Promise<void> {
    shouldBeStarted = true;
    if (disposers.length > 0) return;
    if (startPromise) return startPromise;
    startPromise = (async () => {
      // 关闭保护仅注册监听，提前发起但不 await（原实现在启动尾部 await，拖慢 ready）
      const closeProtectionPromise = initializeCloseProtection();

      const disposeWorkbench = await initializeWorkbenchStore();
      await WorkspaceService.initialize();
      void restoreAccountSessionInBackground();
      OutputService.append("core", "Application services initialized");
      if (!shouldBeStarted || disposers.length > 0) {
        disposeWorkbench();
        void closeProtectionPromise
          .then((disposeCloseProtection) => disposeCloseProtection())
          .catch(() => undefined);
        return;
      }
      disposers = [
        disposeWorkbench,
        initializeTerminalStore(),
        initializeEditorStore(),
        registerWorkbenchCommands(),
      ];
      void closeProtectionPromise
        .then((disposeCloseProtection) => {
          if (!shouldBeStarted) {
            disposeCloseProtection();
            return;
          }
          disposers.push(disposeCloseProtection);
        })
        .catch(() => undefined);
    })();
    try {
      await startPromise;
    } finally {
      startPromise = null;
    }
  },

  dispose(): void {
    shouldBeStarted = false;
    const current = disposers;
    disposers = [];
    for (const dispose of current.reverse()) dispose();
    DebugService.dispose();
    void WorkspaceStore.flush();
  },
};
