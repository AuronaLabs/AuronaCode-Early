import { AccountService } from "../Core/AccountService";
import { DebugService } from "../Core/Debug";
import { DocumentService } from "../Core/Documents";
import { ExtensionRegistry, startExtensionRegistry } from "../Core/Extensions/ExtensionRegistry";
import { GitService } from "../Core/Git";
import { LspClient } from "../Core/Language/LspClient";
import { OutputService } from "../Core/OutputService";
import { RecoveryCoordinator } from "../Core/Recovery/RecoveryCoordinator";
import { saveWindowLayout } from "../Core/WindowLayoutManager";
import { registerWorkbenchNavigation } from "../Core/Workbench/WorkbenchAccess";
import { WorkspaceService } from "../Core/Workspace";
import { desktopWindow } from "../Foundation/Desktop";
import { DisposableScope } from "../Foundation/Lifecycle/DisposableScope";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";
import { initializeEditorStore } from "../State/useEditorStore";
import { initializeTerminalStore } from "../State/useTerminalStore";
import { useWorkbenchStore } from "../State/Workbench/useWorkbenchStore";
import { showToast } from "../UI/Feedback/Toast";
import { startAppearanceController } from "./Bootstrap/AppearanceController";
import { documentLanguageAdapter } from "./Bootstrap/DocumentLanguageAdapter";
import { registerWorkbenchCommands } from "./Contributions/WorkbenchCommands";
import { initializeWorkbenchStore } from "./Workbench/WorkbenchLifecycle";

let current: { scope: DisposableScope; starting: Promise<void> | null } | null = null;

async function initializeCloseProtection(): Promise<() => void> {
  let destroying = false;
  let closing = false;
  const unlisten = await desktopWindow.onCloseRequested(async (event) => {
    if (destroying) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      await RecoveryCoordinator.flushAll();
      await UserConfigStore.flush();
      await WorkspaceStore.flush();
      await DocumentService.closeAll(true);
      await LspClient.shutdownCurrent().catch(console.error);
      await AccountService.shutdown().catch(console.error);
      await saveWindowLayout().catch(console.error);
      destroying = true;
      await desktopWindow.destroy();
    } catch (error) {
      destroying = false;
      OutputService.append("core", `Unable to close safely: ${String(error)}`, "error");
      showToast(String(error), "error");
    } finally {
      closing = false;
    }
  });
  return unlisten;
}

/**
 * 账号会话恢复不在启动关键路径上：restore→refresh→discover 在弱网下可达 30s 超时，
 * 阻塞它会导致 Splash 空转。改为后台执行，登录态由各页面自行订阅账户状态。
 */
async function restoreAccountSessionInBackground(scope: DisposableScope): Promise<void> {
  try {
    await AccountService.initialize(() => !scope.isDisposed);
  } catch (error) {
    console.warn("Account session restore failed; user stays signed out", error);
  }
}

export const AppServices = {
  async start(): Promise<void> {
    if (current) return current.starting ?? undefined;
    const session = { scope: new DisposableScope(), starting: null as Promise<void> | null };
    current = session;
    const { scope } = session;
    session.starting = (async () => {
      void initializeCloseProtection()
        .then((dispose) => scope.add(dispose))
        .catch(console.error);
      try {
        scope.add(await initializeWorkbenchStore());
        if (scope.isDisposed) return;
        scope.add(UserConfigStore.onWriteError((error) => showToast(String(error), "error")));
        scope.add(await startAppearanceController());
        if (scope.isDisposed) return;
        WorkspaceService.prepareInitialization();
        scope.add(GitService.start());
        scope.add(startExtensionRegistry());
        scope.add(
          ExtensionRegistry.subscribe((state, previous) => {
            if (state.lastError && state.lastError !== previous.lastError)
              showToast(state.lastError, "error");
          }),
        );
        scope.add(DocumentService.registerLanguageSync(documentLanguageAdapter));
        scope.add(
          registerWorkbenchNavigation({
            openFile: (path) => useWorkbenchStore.getState().openFile(path),
            reveal: (path, line) => {
              useWorkbenchStore.getState().openFile(path);
              useWorkbenchStore.getState().requestReveal(path, line);
            },
          }),
        );
        scope.add(initializeTerminalStore());
        scope.add(initializeEditorStore());
        scope.add(registerWorkbenchCommands());
        void restoreAccountSessionInBackground(scope);
        OutputService.append("core", "Application services initialized");
      } catch (error) {
        if (current === session) current = null;
        try {
          scope.dispose();
        } catch (cleanupError) {
          console.error(cleanupError);
        }
        throw error;
      }
    })();
    return session.starting;
  },

  dispose(): void {
    const session = current;
    current = null;
    try {
      session?.scope.dispose();
    } catch (error) {
      console.error(error);
    } finally {
      DebugService.dispose();
      void WorkspaceStore.flush().catch(console.error);
    }
  },
};
