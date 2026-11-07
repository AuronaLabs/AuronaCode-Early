import { useEffect, useRef, useState } from "react";
import { useLocale } from "../Foundation/I18n";
import { FileSystemCommands } from "../Foundation/IPC/FileSystemCommands";
import { Button } from "../UI/Components/Button";
import { Modal } from "../UI/Components/Modal";
import { showToast } from "../UI/Feedback/Toast";

import {
  WorkspaceApprovalController,
  type WorkspaceApprovalRequest,
} from "./Workbench/WorkspaceApprovalController";

export function WorkspaceApproval({ visible }: { visible: boolean }) {
  const { t } = useLocale();
  const [request, setRequest] = useState<WorkspaceApprovalRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<WorkspaceApprovalController | null>(null);
  useEffect(() => {
    const session = new WorkspaceApprovalController(setRequest, (error) =>
      showToast(String(error), "error"),
    );
    controller.current = session;
    void session.start().catch((error) => showToast(String(error), "error"));
    return () => {
      session.dispose();
      if (controller.current === session) controller.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.setVisible(visible);
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
