import { useEffect, useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import { NetworkIPC } from "../../Foundation/IPC/NetworkCommands";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";

export type ProxyMode = "system" | "custom" | "none";

export interface NetworkSettingsSectionProps {
  proxyMode: ProxyMode;
  proxyUrl: string;
  onProxyModeChange: (mode: ProxyMode) => void;
  onProxyUrlChange: (url: string) => void;
}

/**
 * 网络设置：代理三档（跟随系统/自定义/直连）。
 * 范围仅覆盖更新检查与工具链下载；Marketplace 扩展下载走前端 fetch，不在覆盖范围内。
 * 地址在失焦或回车时提交，Rust 侧校验失败会给出明确 toast。
 */
export function NetworkSettingsSection({
  proxyMode,
  proxyUrl,
  onProxyModeChange,
  onProxyUrlChange,
}: NetworkSettingsSectionProps) {
  const { t } = useLocale();
  const [urlDraft, setUrlDraft] = useState(proxyUrl);

  // 外部状态变化（重置、搜索定位）时同步草稿
  useEffect(() => {
    setUrlDraft(proxyUrl);
  }, [proxyUrl]);

  const commitUrl = async () => {
    const trimmed = urlDraft.trim();
    if (trimmed === proxyUrl.trim()) return;
    try {
      await NetworkIPC.setNetworkProxy(proxyMode, trimmed || undefined);
      onProxyUrlChange(trimmed);
    } catch (error) {
      showToast(t("settings.networkProxyUrlInvalid").replace("{message}", String(error)), "error");
      setUrlDraft(proxyUrl);
    }
  };

  const handleModeChange = (mode: ProxyMode) => {
    onProxyModeChange(mode);
    // 切换模式立即同步 Rust 侧：custom 沿用已保存地址，其余模式无地址
    void NetworkIPC.setNetworkProxy(
      mode,
      mode === "custom" ? proxyUrl || undefined : undefined,
    ).catch((error) => {
      showToast(t("settings.networkProxyApplyFailed").replace("{message}", String(error)), "error");
    });
  };

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.network")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.networkDescription")}
        </p>
      </div>

      <GlassContainer layer="raised" className="overflow-hidden">
        <div
          data-setting-id="networkProxyMode"
          className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.definitions.networkProxyMode.title")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.definitions.networkProxyMode.description")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={proxyMode}
              onChange={(value) => handleModeChange(value as ProxyMode)}
              className="w-[160px]"
              options={[
                { value: "system", label: t("settings.networkProxyModeSystem") },
                { value: "custom", label: t("settings.networkProxyModeCustom") },
                { value: "none", label: t("settings.networkProxyModeNone") },
              ]}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => handleModeChange("system")}
            />
          </div>
        </div>

        {proxyMode === "custom" && (
          <div
            data-setting-id="networkProxyUrl"
            className="flex flex-col gap-4 border-t border-[var(--border-subtle)] p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
                {t("settings.definitions.networkProxyUrl.title")}
              </span>
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {t("settings.definitions.networkProxyUrl.description")}
              </span>
            </div>
            <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
              <Input
                fullWidth
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                onBlur={() => void commitUrl()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void commitUrl();
                }}
                placeholder={t("settings.networkProxyUrlPlaceholder")}
                aria-label={t("settings.definitions.networkProxyUrl.title")}
                className="sm:w-[280px]"
              />
            </div>
          </div>
        )}
      </GlassContainer>

      <p className="text-[11.5px] leading-5 text-[var(--color-text-muted)]">
        {t("settings.networkScopeNote")}
      </p>
    </div>
  );
}
