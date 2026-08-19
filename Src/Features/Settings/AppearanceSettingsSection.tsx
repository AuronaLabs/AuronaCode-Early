import { useEffect, useState } from "react";
import { ACCENT_THEMES } from "../../App/ThemeAccent";
import { buildThemePreviewGradient, getThemeDefinition } from "../../App/themePalettes";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import type { AccentThemeId } from "../../Foundation/Types/Config";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer, type GlassIntensity } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

interface AppearanceSettingsSectionProps {
  accentTheme: AccentThemeId;
  intensity: GlassIntensity;
  liquidTexture: boolean;
  boldText: boolean;
  interfaceFontSize: "compact" | "default" | "comfortable" | "large";
  onAccentThemeChange: (accent: AccentThemeId) => void;
  onIntensityChange: (intensity: GlassIntensity) => void;
  onLiquidTextureChange: (enabled: boolean) => void;
  onBoldTextChange: (enabled: boolean) => void;
  onInterfaceFontSizeChange: (size: "compact" | "default" | "comfortable" | "large") => void;
}

export function AppearanceSettingsSection({
  accentTheme,
  intensity,
  liquidTexture,
  boldText,
  interfaceFontSize,
  onAccentThemeChange,
  onIntensityChange,
  onLiquidTextureChange,
  onBoldTextChange,
  onInterfaceFontSizeChange,
}: AppearanceSettingsSectionProps) {
  const { t } = useLocale();
  const themeLabel = (id: AccentThemeId) => t(`settings.themes.${id}` as I18nKey);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.appearanceSection.title")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.appearanceSection.description")}
        </p>
      </div>

      <GlassContainer layer="elevated" className="overflow-hidden rounded-2xl">
        <div data-setting-id="accentTheme" className="p-3 sm:p-4">
          <div className="mb-3 flex items-start justify-between gap-2 px-1">
            <div className="flex flex-col gap-1">
              <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
                {t("settings.appearanceSection.accentTitle")}
              </span>
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {t("settings.appearanceSection.accentDescription")}
              </span>
            </div>
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => onAccentThemeChange("aurora")}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ACCENT_THEMES.map((accent) => {
              const selected = accentTheme === accent.id;
              return (
                <button
                  type="button"
                  key={accent.id}
                  aria-pressed={selected}
                  onClick={() => onAccentThemeChange(accent.id)}
                  className={`group relative flex min-h-[68px] overflow-hidden rounded-xl border p-2.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ${
                    selected
                      ? "border-[color-mix(in_srgb,var(--color-accent)_32%,var(--border-subtle))] bg-[var(--material-interactive-active)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_14%,transparent)]"
                      : "border-[var(--border-subtle)] bg-[var(--material-surface)] hover:border-[var(--border-overlay)] hover:bg-[var(--material-interactive-hover)] hover:-translate-y-px"
                  }`}
                >
                  <span
                    className="relative flex h-[58px] w-full items-end overflow-hidden rounded-lg border border-[var(--border-subtle)]"
                    aria-hidden="true"
                  >
                    <span
                      className="absolute inset-0"
                      style={{
                        background: buildThemePreviewGradient(
                          getThemeDefinition(accent.id),
                          isDark ? "dark" : "light",
                        ),
                      }}
                    />
                    <span
                      className="absolute right-1.5 top-1.5 size-3 rounded-full border border-white/70 shadow-sm"
                      style={{ backgroundColor: `rgb(${accent.rgb})` }}
                    />
                    <span className="relative z-10 flex w-full items-center gap-1.5 bg-[linear-gradient(to_top,color-mix(in_srgb,var(--material-overlay)_88%,transparent),transparent)] px-2 pb-1.5 pt-4">
                      <span className="truncate text-[11px] font-semibold text-[var(--color-text-highlight)]">
                        {themeLabel(accent.id)}
                      </span>
                      {accent.isDefault && (
                        <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-1 py-0.5 text-[9px] font-semibold leading-none text-[var(--color-accent)]">
                          {t("settings.appearanceSection.defaultBadge")}
                        </span>
                      )}
                    </span>
                  </span>
                  {selected && (
                    <Icons.Check
                      className="absolute left-1.5 top-1.5 z-20 text-[var(--color-text-highlight)]"
                      size={15}
                      stroke={2.5}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </GlassContainer>

      <div className="mt-2 flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.appearanceSection.effectsTitle")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.appearanceSection.effectsDescription")}
        </p>
      </div>

      <GlassContainer layer="elevated" className="overflow-hidden rounded-2xl">
        <div data-setting-id="materialIntensity" className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.appearanceSection.intensity")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.appearanceSection.intensityDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={intensity}
              onChange={(value) => onIntensityChange(value as GlassIntensity)}
              className="w-[140px]"
              options={[
                { value: "light", label: t("settings.appearanceSection.intensityLight") },
                { value: "medium", label: t("settings.appearanceSection.intensityMedium") },
                { value: "heavy", label: t("settings.appearanceSection.intensityHeavy") },
              ]}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => onIntensityChange("medium")}
            />
          </div>
        </div>
        <div
          data-setting-id="liquidTexture"
          className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="min-w-0 pr-2">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.appearanceSection.liquid")}
            </span>
            <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("settings.appearanceSection.liquidDescription")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={liquidTexture}
              onCheckedChange={onLiquidTextureChange}
              aria-label={t("settings.appearanceSection.liquidLabel")}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => onLiquidTextureChange(false)}
            />
          </div>
        </div>
        <div
          data-setting-id="boldText"
          className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="min-w-0 pr-2">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.appearanceSection.boldText")}
            </span>
            <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("settings.appearanceSection.boldTextDescription")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={boldText}
              onCheckedChange={onBoldTextChange}
              aria-label={t("settings.appearanceSection.boldText")}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => onBoldTextChange(false)}
            />
          </div>
        </div>
        <div
          data-setting-id="interfaceFontSize"
          className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="min-w-0 pr-2">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.appearanceSection.interfaceFontSize")}
            </span>
            <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("settings.appearanceSection.interfaceFontSizeDescription")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={interfaceFontSize}
              onChange={(value) =>
                onInterfaceFontSizeChange(value as "compact" | "default" | "comfortable" | "large")
              }
              className="w-[140px]"
              options={[
                { value: "compact", label: t("settings.appearanceSection.fontSizeCompact") },
                { value: "default", label: t("settings.appearanceSection.fontSizeDefault") },
                {
                  value: "comfortable",
                  label: t("settings.appearanceSection.fontSizeComfortable"),
                },
                { value: "large", label: t("settings.appearanceSection.fontSizeLarge") },
              ]}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => onInterfaceFontSizeChange("default")}
            />
          </div>
        </div>
      </GlassContainer>
    </div>
  );
}
