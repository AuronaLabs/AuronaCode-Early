import { type Locale, useLocale } from "../../Foundation/I18n";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

export type Density = "compact" | "default" | "regular" | "comfortable";

export interface GeneralSettingsSectionProps {
  theme: "light" | "dark" | "system";
  density: Density;
  muteNonCriticalToasts?: boolean;
  toastDuration?: number;
  onThemeChange: (newTheme: "light" | "dark" | "system") => void;
  onDensityChange: (next: Density) => void;
  onMuteNonCriticalChange?: (muted: boolean) => void;
  onToastDurationChange?: (duration: number) => void;
}

export function GeneralSettingsSection({
  theme,
  density,
  muteNonCriticalToasts = false,
  toastDuration = 4000,
  onThemeChange,
  onDensityChange,
  onMuteNonCriticalChange,
  onToastDurationChange,
}: GeneralSettingsSectionProps) {
  const { locale, setLocale, t } = useLocale();

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.general")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.generalDescription")}
        </p>
      </div>

      <GlassContainer layer="raised" className="overflow-hidden">
        <div
          data-setting-id="theme"
          className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.theme")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.themeDescription")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <fieldset className="grid w-full grid-cols-3 gap-1 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--material-panel)] p-1.5 shadow-[inset_0_1px_1px_var(--material-inset)] sm:w-auto">
              <legend className="sr-only">{t("settings.theme")}</legend>
              {(["system", "light", "dark"] as const).map((mode) => (
                <button
                  type="button"
                  aria-pressed={theme === mode}
                  key={mode}
                  onClick={() => onThemeChange(mode)}
                  className={`flex min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 sm:min-w-[104px] cursor-pointer ${
                    theme === mode
                      ? "border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
                  }`}
                >
                  {mode === "system" && (
                    <>
                      <Icons.Monitor size={16} /> {t("settings.themeSystem")}
                    </>
                  )}
                  {mode === "light" && (
                    <>
                      <Icons.Sun size={16} /> {t("settings.themeLight")}
                    </>
                  )}
                  {mode === "dark" && (
                    <>
                      <Icons.Moon size={16} /> {t("settings.themeDark")}
                    </>
                  )}
                </button>
              ))}
            </fieldset>
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => onThemeChange("system")}
            />
          </div>
        </div>

        <div
          data-setting-id="density"
          className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.density")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.densityDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={density}
              onChange={(value) => onDensityChange(value as Density)}
              className="w-[140px]"
              options={[
                { value: "default", label: t("settings.densityAuto") },
                { value: "compact", label: t("settings.densityCompact") },
                { value: "regular", label: t("settings.densityRegular") },
                { value: "comfortable", label: t("settings.densityComfortable") },
              ]}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => onDensityChange("default")}
            />
          </div>
        </div>

        <div
          data-setting-id="language"
          className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.language")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.languageDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={locale}
              onChange={(value) => setLocale(value as Locale)}
              className="w-[160px]"
              options={[
                { value: "zh-CN", label: t("settings.languageZhCN") },
                { value: "zh-Hant", label: t("settings.languageZhHant") },
                { value: "en", label: t("settings.languageEn") },
              ]}
            />
            <SettingResetButton label={t("settings.reset")} onReset={() => setLocale("zh-CN")} />
          </div>
        </div>
      </GlassContainer>

      {/* 通知中心与弹窗设置卡片 */}
      <div className="flex flex-col gap-2 pt-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.notificationsTitle")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.notificationsDescription")}
        </p>
      </div>

      <GlassContainer layer="raised" className="overflow-hidden">
        <div
          data-setting-id="muteNonCritical"
          className="flex items-center justify-between gap-4 p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.muteNonCritical")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)] max-w-lg">
              {t("settings.muteNonCriticalDesc")}
            </span>
          </div>
          <Switch
            checked={muteNonCriticalToasts}
            onCheckedChange={(checked) => onMuteNonCriticalChange?.(checked)}
            aria-label={t("settings.muteNonCritical")}
          />
        </div>

        <div
          data-setting-id="toastDuration"
          className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.toastDuration")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.toastDurationDesc")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={String(toastDuration)}
              onChange={(value) => onToastDurationChange?.(Number(value))}
              className="w-[160px]"
              options={[
                { value: "2500", label: t("settings.durationFast") },
                { value: "4000", label: t("settings.durationNormal") },
                { value: "6000", label: t("settings.durationSlow") },
                { value: "8000", label: t("settings.durationManual") },
              ]}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => onToastDurationChange?.(4000)}
            />
          </div>
        </div>
      </GlassContainer>
    </div>
  );
}
