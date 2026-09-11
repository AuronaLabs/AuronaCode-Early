import { useState } from "react";
import { UpdaterService } from "../../Core/UpdaterService";
import { BaseDirectory, desktopFileSystem } from "../../Foundation/Desktop";
import { useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { useFeatureFlagStore } from "../../State/useFeatureFlagStore";
import { Button } from "../../UI/Components/Button";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";

export function AdvancedSettingsSection() {
  const { t } = useLocale();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const channel = useFeatureFlagStore((state) => state.channel);
  const setChannel = useFeatureFlagStore((state) => state.setChannel);

  const handleChannelSwitch = async (enabled: boolean) => {
    const nextChannel = enabled ? "pioneer" : "stable";
    await setChannel(nextChannel);
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const result = await UpdaterService.checkForUpdates();
      if (result.status === "available") {
        showToast(`${t("titleBar.updateAvailable")}: v${result.update.version}`, "info");
      } else if (result.status === "up-to-date") {
        showToast(t("settings.toast.upToDate"), "success");
      } else if (result.status === "error") {
        showToast(result.error || t("settings.toast.checkUpdateFailed"), "error");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

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

      <GlassContainer layer="raised" className="overflow-hidden flex flex-col">
        {/* 1. 先锋计划开关 */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col gap-1 pr-4">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.featureFlags.channelPioneerTitle")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
              {channel === "pioneer"
                ? t("settings.featureFlags.channelPioneerDesc")
                : t("settings.featureFlags.channelStableDesc")}
            </span>
          </div>

          <Switch
            checked={channel === "pioneer"}
            onCheckedChange={handleChannelSwitch}
            aria-label={t("settings.featureFlags.channelPioneerTitle")}
          />
        </div>

        {/* 2. 检查更新 */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.checkUpdate")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {channel === "pioneer"
                ? t("settings.featureFlags.pioneerUpdateCheckDesc")
                : t("update.officialChannel")}
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

        {/* 3. 初始化重置 */}
        <div className="flex items-center justify-between p-5">
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
