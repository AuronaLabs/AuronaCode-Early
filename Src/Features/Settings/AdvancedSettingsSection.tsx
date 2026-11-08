import { useState } from "react";
import { useOobeStore } from "../../App/Oobe/useOobeStore";
import { UpdaterService } from "../../Core/UpdaterService";
import { BaseDirectory, desktopFileSystem } from "../../Foundation/Desktop";
import { useLocale } from "../../Foundation/I18n";
import { formatDisplayVersion } from "../../Foundation/Release/ReleaseChannel";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { clearAppGlobalLocalState } from "./storageOwnership";

export function AdvancedSettingsSection() {
  const { t } = useLocale();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const result = await UpdaterService.checkForUpdates();
      if (result.status === "available") {
        showToast(
          `${t("titleBar.updateAvailable")}: ${formatDisplayVersion(result.update.version)}`,
          "info",
        );
      } else if (result.status === "up-to-date") {
        showToast(t("settings.toast.upToDate"), "success");
      } else if (result.status === "error") {
        showToast(
          result.error === "timeout"
            ? t("settings.toast.updateCheckTimeout")
            : result.error || t("settings.toast.checkUpdateFailed"),
          "error",
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="settings-section-header">
        <h3 className="settings-section-title">{t("settings.categories.advanced")}</h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.advancedDescription")}
        </p>
      </div>

      <GlassContainer layer="raised" className="overflow-hidden flex flex-col">
        {/* 检查更新 */}
        <div className="settings-row flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.checkUpdate")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("update.officialChannel")}
            </span>
          </div>
          <Button
            variant="secondary"
            className="h-8 text-[12px] px-3.5"
            disabled={isCheckingUpdate}
            onClick={handleCheckUpdate}
          >
            <Icons.Refresh size={14} className={isCheckingUpdate ? "animate-spin" : ""} />
            {isCheckingUpdate ? t("settings.checkingUpdate") : t("settings.checkUpdate")}
          </Button>
        </div>

        {/* 欢迎引导 */}
        <div className="settings-row flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.oobeRerun.title")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.oobeRerun.desc")}
            </span>
          </div>
          <Button
            variant="secondary"
            className="h-8 text-[12px] px-3.5"
            onClick={() => useOobeStore.getState().open("rerun")}
          >
            <Icons.Sparkles size={14} />
            {t("settings.oobeRerun.action")}
          </Button>
        </div>

        {/* 初始化重置 */}
        <div className="settings-row flex items-center justify-between gap-6 p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.resetApp")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.resetAppDescription")}
            </span>
          </div>
          <Button
            variant="danger"
            className="h-8 text-[12px] px-3.5"
            onClick={async () => {
              clearAppGlobalLocalState();
              try {
                await desktopFileSystem.remove("user-config.json", {
                  baseDir: BaseDirectory.AppLocalData,
                });
                await desktopFileSystem.remove("workspace.json", {
                  baseDir: BaseDirectory.AppLocalData,
                });
              } catch {
                // Ignore missing file errors
              }
              await UserConfigStore.set({});
              await WorkspaceStore.set({});
              showToast(t("settings.toast.resetCompleted"), "success");
              setTimeout(() => window.location.reload(), 1000);
            }}
          >
            {t("settings.resetAppAction")}
          </Button>
        </div>
      </GlassContainer>
    </div>
  );
}
