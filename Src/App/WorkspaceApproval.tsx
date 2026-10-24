import { useEffect, useRef, useState } from "react";
import { WorkspaceService } from "../Core/WorkspaceService";
import { LocaleService, useLocale } from "../Foundation/I18n";
import { FileSystemCommands } from "../Foundation/IPC/FileSystemCommands";
import { Button } from "../UI/Components/Button";
import { Modal } from "../UI/Components/Modal";
import { dismissNotification, showNotification, showToast } from "../UI/Feedback/Toast";

type Approval = { id: string; path: string };

export function WorkspaceApproval({ visible }: { visible: boolean }) {
  const { t } = useLocale();
  const [request, setRequest] = useState<Approval | null>(null);
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const disposers: (() => void)[] = [];
    const pending = new Set<string>();
    void (async () => {
      const registrations = await Promise.allSettled([
        FileSystemCommands.onWorkspaceApproval((approval) => {
          if (!active) {
            void FileSystemCommands.resolveWorkspaceApproval(approval.id, false).catch(
              console.error,
            );
            return;
          }
          pending.add(approval.id);
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
                  reviewing = true;
                  setRequest(approval);
                },
              },
            ],
            onDismiss: () => {
              if (!reviewing)
                void FileSystemCommands.resolveWorkspaceApproval(approval.id, false).catch(
                  console.error,
                );
            },
          });
        }),
        FileSystemCommands.onWorkspaceApprovalClosed((id) => {
          if (!active) return;
          pending.delete(id);
          dismissNotification(id);
          setRequest((current) => (current?.id === id ? null : current));
        }),
      ]);
      const subscriptions = registrations.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failure = registrations.find((result) => result.status === "rejected");
      if (failure) {
        for (const dispose of subscriptions) dispose();
        throw failure.reason;
      }
      disposers.push(...subscriptions);
      if (!active) {
        for (const dispose of subscriptions) dispose();
        return;
      }
      if (!initialized.current) {
        initialized.current = true;
        await WorkspaceService.initialize();
      }
    })().catch((error) => {
      if (active) {
        void WorkspaceService.cancelInitialization();
        showToast(String(error), "error");
      }
    });
    return () => {
      active = false;
      for (const dispose of disposers) dispose();
      for (const id of pending) {
        dismissNotification(id);
        void FileSystemCommands.resolveWorkspaceApproval(id, false).catch(console.error);
      }
    };
  }, [visible]);

  const resolve = async (approved: boolean) => {
    if (!request || busy) return;
    setBusy(true);
    try {
      await FileSystemCommands.resolveWorkspaceApproval(request.id, approved);
      setRequest(null);
    } catch (error) {
      showToast(String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={request !== null}
      onClose={() => void resolve(false)}
      title={t("workspaceApproval.title")}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => void resolve(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy} onClick={() => void resolve(true)}>
            {t("workspaceApproval.allow")}
          </Button>
        </>
      }
    >
      <p>{t("workspaceApproval.description")}</p>
      <p className="mt-3 break-all font-mono text-[12px]">{request?.path}</p>
    </Modal>
  );
}
