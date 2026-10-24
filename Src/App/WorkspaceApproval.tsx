import { useCallback, useEffect, useRef, useState } from "react";
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
  const initializing = useRef(false);
  const visibleRef = useRef(visible);
  const queued = useRef(new Map<string, Approval>());
  const registrationReady = useRef<Promise<void> | null>(null);
  const initializationFailureHandled = useRef(false);
  const handleInitializationFailure = useCallback((error: unknown) => {
    if (initializationFailureHandled.current) return;
    initializationFailureHandled.current = true;
    void WorkspaceService.cancelInitialization();
    showToast(String(error), "error");
  }, []);

  useEffect(() => {
    let active = true;
    const disposers: (() => void)[] = [];
    const pending = new Set<string>();
    const present = (approval: Approval) => {
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
    };
    const register = (async () => {
      const registrations = await Promise.allSettled([
        FileSystemCommands.onWorkspaceApproval((approval) => {
          if (!active) {
            void FileSystemCommands.resolveWorkspaceApproval(approval.id, false).catch(
              console.error,
            );
            return;
          }
          pending.add(approval.id);
          if (visibleRef.current) present(approval);
          else queued.current.set(approval.id, approval);
        }),
        FileSystemCommands.onWorkspaceApprovalClosed((id) => {
          if (!active) return;
          pending.delete(id);
          queued.current.delete(id);
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
      disposers.push(...subscriptions);
    })();
    registrationReady.current = register;
    register.catch((error) => {
      if (active) handleInitializationFailure(error);
    });
    return () => {
      active = false;
      for (const dispose of disposers) dispose();
      for (const id of pending) {
        dismissNotification(id);
        void FileSystemCommands.resolveWorkspaceApproval(id, false).catch(console.error);
      }
      queued.current.clear();
    };
  }, [handleInitializationFailure]);

  useEffect(() => {
    visibleRef.current = visible;
    if (!visible) return;
    for (const approval of queued.current.values()) {
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
    }
    queued.current.clear();
    if (initialized.current || initializing.current) return;
    initializing.current = true;
    void (registrationReady.current ?? Promise.resolve())
      .then(() => WorkspaceService.initialize())
      .then(() => {
        initialized.current = true;
      })
      .catch((error) => {
        handleInitializationFailure(error);
      })
      .finally(() => {
        initializing.current = false;
      });
  }, [visible, handleInitializationFailure]);

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
