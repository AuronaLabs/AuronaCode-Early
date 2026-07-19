import { useEffect, useState } from "react";
import { UpdaterService } from "../../Core/UpdaterService";
import type { UpdateInfo } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { Button } from "../Components/Button";
import { Modal } from "../Components/Modal";
import { Icons } from "../Icons/IconManager";
import { MarkdownContent } from "./MarkdownContent";

export function UpdateModal() {
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
        setProgressText("正在连接更新服务器...");
      } else if (data.status === "progress") {
        setIsUpdating(true);
        setProgressText(`正在下载: ${Math.round(data.progress * 100)}%`);
      } else if (data.status === "finished") {
        setProgressText("下载完成，正在重启安装...");
      } else if (data.status === "error") {
        setIsUpdating(false);
        setProgressText("");
        EventBus.emit("app:toast", { type: "error", message: `更新失败: ${data.error}` });
      }
    });

    return () => {
      unsubAvailable();
      unsubShow();
      unsubProgress();
    };
  }, [updateInfo]);

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
      title={`发现新版本 v${updateInfo.version}`}
      icon={<Icons.Download className="text-[var(--AccentPrimary)]" size={18} stroke={2} />}
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="text-[12px] text-[var(--TextMuted)]">
            {isUpdating ? progressText : "更新将自动重启应用。"}
          </div>
          <div className="flex gap-2">
            {!isUpdating && (
              <Button variant="secondary" onClick={() => setIsOpen(false)}>
                稍后
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
                  下载中...
                </div>
              ) : (
                "下载并重启安装"
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-3">
        <div className="text-[13px] text-[var(--TextMuted)]">
          发布日期: {updateInfo.date ? new Date(updateInfo.date).toLocaleDateString() : "未知"}
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)] p-4 shadow-[var(--shadow-surface)]">
          <MarkdownContent source={updateInfo.body || "本次更新包含了性能改进与错误修复。"} />
        </div>
      </div>
    </Modal>
  );
}
