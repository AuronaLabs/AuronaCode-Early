import { WorkspaceService } from "../../Core/Workspace";
import { LocaleService } from "../../Foundation/I18n";
import { FileSystemCommands } from "../../Foundation/IPC/FileSystemCommands";
import { DisposableScope } from "../../Foundation/Lifecycle/DisposableScope";
import { dismissNotification, showNotification } from "../../UI/Feedback/Toast";

export type WorkspaceApprovalRequest = { id: string; path: string };

/** One mounted workbench owns listeners, queued prompts and its startup attempt. */
export class WorkspaceApprovalController {
  private readonly scope = new DisposableScope();
  private readonly pending = new Map<string, WorkspaceApprovalRequest>();
  private readonly displayed = new Set<string>();
  private visible = false;
  private ready = false;
  private initialized = false;
  private failed = false;

  constructor(
    private readonly review: (request: WorkspaceApprovalRequest | null) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  async start(): Promise<void> {
    const registrations = await Promise.allSettled([
      FileSystemCommands.onWorkspaceApproval((approval) => {
        if (this.scope.isDisposed) {
          this.reject(approval.id);
          return;
        }
        this.pending.set(approval.id, approval);
        this.present();
      }),
      FileSystemCommands.onWorkspaceApprovalClosed((id) => {
        if (this.scope.isDisposed) return;
        this.pending.delete(id);
        this.displayed.delete(id);
        dismissNotification(id);
        this.review(null);
      }),
    ]);
    for (const result of registrations)
      if (result.status === "fulfilled") this.scope.add(result.value);
    if (this.scope.isDisposed) return;
    const failure = registrations.find((result) => result.status === "rejected");
    if (failure) {
      this.scope.dispose();
      this.fail(failure.reason);
      return;
    }
    this.ready = true;
    this.present();
    this.initialize();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.present();
    this.initialize();
  }

  private initialize(): void {
    if (!this.ready || !this.visible || this.scope.isDisposed || this.initialized || this.failed)
      return;
    this.initialized = true;
    void WorkspaceService.initialize().catch((error) => {
      if (!this.scope.isDisposed) this.fail(error);
    });
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    void WorkspaceService.cancelInitialization().catch(console.error);
    this.onError(error);
  }

  private reject(id: string): void {
    void FileSystemCommands.resolveWorkspaceApproval(id, false).catch(console.error);
  }

  private present(): void {
    if (!this.visible || !this.ready || this.scope.isDisposed) return;
    for (const approval of this.pending.values()) {
      if (this.displayed.has(approval.id)) continue;
      this.displayed.add(approval.id);
      let reviewing = false;
      showNotification({
        id: approval.id,
        type: "confirm",
        title: LocaleService.translate("workspaceApproval.title"),
        message: approval.path,
        duration: null,
        actions: [
          {
            label: LocaleService.translate("workspaceApproval.review"),
            primary: true,
            onClick: () => {
              if (!this.pending.has(approval.id) || this.scope.isDisposed) return;
              reviewing = true;
              this.review(approval);
            },
          },
        ],
        onDismiss: () => {
          if (!reviewing && this.pending.has(approval.id)) this.reject(approval.id);
        },
      });
    }
  }

  dispose(): void {
    try {
      this.scope.dispose();
    } finally {
      for (const id of this.pending.keys()) {
        this.pending.delete(id);
        dismissNotification(id);
        this.reject(id);
      }
      this.displayed.clear();
    }
  }
}
