import { useEffect, useState } from "react";
import { UpdaterService } from "../../Core/UpdaterService";
import type { UpdateInfo } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { Button } from "../Components/Button";
import { Modal } from "../Components/Modal";
import { Icons } from "../Icons/IconManager";
import { MarkdownContent } from "./MarkdownContent";

export function UpdateModal() {
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [progressText, setProgressText] = useState("");

  useEffect(() => {
    const unsubAvailable = EventBus.on("app:update-available", (update) => {
      setUpdateInfo(update);
      setIsOpen(true);
    });

    const unsubShow = EventBus.on("app:show-update-modal", () => {
      const update = updateInfo ?? UpdaterService.currentUpdate;
      if (update) {
        setUpdateInfo(update);
        setIsOpen(true);
      }
    });

    const unsubProgress = EventBus.on("app:update-progress", (data) => {
      if (data.status === "started") {
        setIsUpdating(true);
        setProgressText(t("update.connecting"));
      } else if (data.status === "progress") {
        setIsUpdating(true);
        setProgressText(
          t("update.downloading").replace("{percent}", String(Math.round(data.progress * 100))),
        );
      } else if (data.status === "finished") {
        setProgressText(t("update.restarting"));
      } else if (data.status === "error") {
        setIsUpdating(false);
        setProgressText("");
        EventBus.emit("app:toast", {
          type: "error",
          message: t("update.failed").replace("{message}", data.error),
        });
      }
    });

    return () => {
      unsubAvailable();
      unsubShow();
      unsubProgress();
    };
  }, [t, updateInfo]);

  const handleInstall = async () => {
    setIsUpdating(true);
    await UpdaterService.installUpdate();
  };

  if (!updateInfo) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isUpdating) setIsOpen(false);
      }}
      title={t("update.newVersion").replace("{version}", updateInfo.version)}
      icon={<Icons.Download className="text-[var(--color-accent)]" size={18} stroke={2} />}
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="text-[12px] text-[var(--color-text-muted)]">
            {isUpdating ? progressText : t("update.restartHint")}
          </div>
          <div className="flex gap-2">
            {!isUpdating && (
              <Button variant="secondary" onClick={() => setIsOpen(false)}>
                {t("update.later")}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleInstall}
              disabled={isUpdating}
              className="min-w-[120px]"
            >
              {isUpdating ? (
                <div className="flex items-center gap-2">
                  <Icons.Refresh size={14} className="animate-spin" />
                  {t("update.downloadingLabel")}
                </div>
              ) : (
                t("update.installAndRestart")
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex max-h-[52vh] flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1.5">
            <Icons.History size={13} stroke={1.7} />
            {updateInfo.date
              ? new Date(updateInfo.date).toLocaleDateString()
              : t("update.releaseDateUnknown")}
          </span>
          <span className="h-1 w-1 rounded-full bg-[var(--color-text-muted)] opacity-45" />
          <span>{t("update.officialChannel")}</span>
        </div>
        <div className="pb-1">
          <MarkdownContent source={updateInfo.body || t("update.defaultBody")} />
        </div>
      </div>
    </Modal>
  );
}
