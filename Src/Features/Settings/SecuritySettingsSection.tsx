import { type ReactNode, useEffect, useRef, useState } from "react";
import { LspClient } from "../../Core/Language/LspClient";
import { LanguageConfigurationService } from "../../Core/LanguageConfigurationService";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { SecurityPreferences } from "../../Foundation/Types/Config";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";

const settings = [
  {
    key: "requireExtensionSignature",
    id: "extensionSignature",
    title: "extensionSignature",
    defaultValue: true,
  },
  {
    key: "requireExtensionCatalogSignature",
    id: "catalogSignature",
    title: "catalogSignature",
    defaultValue: true,
  },
  {
    key: "autoTrustWorkspaceLanguageServers",
    id: "languageServerAutoTrust",
    title: "autoTrustWorkspace",
    defaultValue: false,
  },
  {
    key: "requireLocalProcessApproval",
    id: "localProcessApproval",
    title: "localProcessApproval",
    defaultValue: true,
  },
  {
    key: "requireWorkspaceApproval",
    id: "workspaceApproval",
    title: "workspaceApproval",
    defaultValue: true,
  },
  {
    key: "requireAiEndpointApproval",
    id: "aiEndpointApproval",
    title: "aiEndpointApproval",
    defaultValue: true,
  },
  {
    key: "requirePackageInstallApproval",
    id: "packageInstallApproval",
    title: "packageInstallApproval",
    defaultValue: true,
  },
  {
    key: "requireExtensionExecutionApproval",
    id: "extensionExecutionApproval",
    title: "extensionExecutionApproval",
    defaultValue: true,
  },
  {
    key: "requireDeleteApproval",
    id: "deleteApproval",
    title: "deleteApproval",
    defaultValue: true,
  },
  {
    key: "requireGitDiscardApproval",
    id: "gitDiscardApproval",
    title: "gitDiscardApproval",
    defaultValue: true,
  },
] as const;

export function SecuritySettingsSection() {
  const { t } = useLocale();
  const [preferences, setPreferences] = useState<SecurityPreferences>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    void UserConfigStore.get()
      .then((config) => {
        if (!active) return;
        setPreferences(config.security ?? {});
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (active) showToast(error instanceof Error ? error.message : String(error), "error");
      });
    return () => {
      active = false;
    };
  }, []);

  const updatePreference = async (key: keyof SecurityPreferences, value: boolean) => {
    if (!loaded || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const config = await UserConfigStore.update((current) => ({
        security: { ...current.security, [key]: value },
      }));
      setPreferences(config.security ?? {});
      if (key === "autoTrustWorkspaceLanguageServers") {
        await LanguageConfigurationService.checkWorkspaceTrust();
        EventBus.emit("settings:language-changed");
        await LspClient.getInstance().reloadConfiguredServers();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <fieldset
      disabled={!loaded || saving}
      aria-busy={!loaded || saving}
      className="flex w-full max-w-3xl flex-col gap-6"
    >
      <section className="space-y-2">
        <div>
          <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
            {t("settings.securitySettings.sectionTitle")}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
            {t("settings.securitySettings.sectionDescription")}
          </p>
        </div>
        <GlassContainer layer="raised" className="overflow-hidden">
          {settings.map((setting) => {
            const title = t(`settings.securitySettings.${setting.title}`);
            return (
              <SettingRow
                key={setting.key}
                settingId={setting.id}
                title={title}
                description={t(`settings.securitySettings.${setting.title}Description`)}
                onReset={() => void updatePreference(setting.key, setting.defaultValue)}
                control={
                  <Switch
                    checked={preferences[setting.key] ?? setting.defaultValue}
                    onCheckedChange={(checked) => void updatePreference(setting.key, checked)}
                    aria-label={title}
                  />
                }
              />
            );
          })}
        </GlassContainer>
      </section>
    </fieldset>
  );
}

function SettingRow({
  settingId,
  title,
  description,
  control,
  onReset,
}: {
  settingId: string;
  title: string;
  description: string;
  control: ReactNode;
  onReset: () => void;
}) {
  return (
    <div
      data-setting-id={settingId}
      className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
    >
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-[var(--color-text-highlight)]">{title}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {control}
        <span className="ml-1 flex">
          <SettingResetButton label={title} onReset={onReset} />
        </span>
      </div>
    </div>
  );
}
