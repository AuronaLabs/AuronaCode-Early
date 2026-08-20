import { type Locale, useLocale } from "../../Foundation/I18n";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

export type Density = "compact" | "default" | "regular" | "comfortable";

export interface GeneralSettingsSectionProps {
  theme: "light" | "dark" | "system";
  density: Density;
  onThemeChange: (newTheme: "light" | "dark" | "system") => void;
  onDensityChange: (next: Density) => void;
}

export function GeneralSettingsSection({
  theme,
  density,
  onThemeChange,
  onDensityChange,
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

      <GlassContainer layer="elevated" className="overflow-hidden rounded-2xl">
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
            <fieldset className="grid w-full grid-cols-3 gap-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--material-panel)] p-1.5 shadow-[inset_0_1px_1px_var(--material-inset)] backdrop-blur-[var(--glass-blur-base)] sm:w-auto">
              <legend className="sr-only">{t("settings.theme")}</legend>
              {(["system", "light", "dark"] as const).map((mode) => (
                <button
                  type="button"
                  aria-pressed={theme === mode}
                  key={mode}
                  onClick={() => onThemeChange(mode)}
                  className={`flex min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 sm:min-w-[104px] ${
                    theme === mode
                      ? "border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)] backdrop-blur-[var(--glass-blur-elevated)]"
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
    </div>
  );
}
