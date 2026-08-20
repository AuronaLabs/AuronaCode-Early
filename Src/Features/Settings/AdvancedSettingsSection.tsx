import { useState } from "react";
import { UpdaterService } from "../../Core/UpdaterService";
import { BaseDirectory, desktopFileSystem } from "../../Foundation/Desktop";
import { useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";

export function AdvancedSettingsSection() {
  const { t } = useLocale();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.advanced")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.advancedDescription")}
        </p>
      </div>

      <GlassContainer layer="elevated" className="rounded-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("titleBar.updateAvailable")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("update.officialChannel")}
            </span>
          </div>
          <Button
            variant="secondary"
            className="h-8 text-[12px] px-3.5"
            disabled={isCheckingUpdate}
            onClick={() => {
              setIsCheckingUpdate(true);
              UpdaterService.checkForUpdates().finally(() => {
                setIsCheckingUpdate(false);
              });
            }}
          >
            <Icons.Refresh size={14} className={isCheckingUpdate ? "animate-spin" : ""} />
            {isCheckingUpdate ? t("update.downloadingLabel") : t("common.retry")}
          </Button>
        </div>

        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("workspace.discardChanges")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("workspace.unsavedHint")}
            </span>
          </div>
          <Button
            variant="danger"
            className="h-8 text-[12px] px-3.5"
            onClick={async () => {
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
              showToast(t("settings.toast.remoteUpdated"), "success");
              setTimeout(() => window.location.reload(), 1000);
            }}
          >
            {t("settings.reset")}
          </Button>
        </div>
      </GlassContainer>
    </div>
  );
}
