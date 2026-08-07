import { ACCENT_THEMES } from "../../App/ThemeAccent";
import { useLocale } from "../../Foundation/I18n";
import type { AccentThemeId } from "../../Foundation/Types/Config";
import { Select } from "../../UI/Components/Select";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer, type GlassIntensity } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

interface AppearanceSettingsSectionProps {
  accentTheme: AccentThemeId;
  intensity: GlassIntensity;
  liquidTexture: boolean;
  onAccentThemeChange: (accent: AccentThemeId) => void;
  onIntensityChange: (intensity: GlassIntensity) => void;
  onLiquidTextureChange: (enabled: boolean) => void;
}

export function AppearanceSettingsSection({
  accentTheme,
  intensity,
  liquidTexture,
  onAccentThemeChange,
  onIntensityChange,
  onLiquidTextureChange,
}: AppearanceSettingsSectionProps) {
  const { t } = useLocale();
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
        <div className="p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-1 px-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.appearanceSection.accentTitle")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.appearanceSection.accentDescription")}
            </span>
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
                      : "border-transparent bg-[var(--material-panel)] hover:border-[var(--border-subtle)] hover:bg-[var(--material-interactive-hover)] hover:-translate-y-px"
                  }`}
                >
                  <span
                    className="absolute -right-3 -top-3 h-14 w-14 rounded-full opacity-90 blur-[1px] transition-transform duration-200 group-hover:scale-110"
                    style={{ backgroundColor: `rgb(${accent.rgb})` }}
                  />
                  <span className="relative flex min-w-0 flex-1 flex-col gap-1">
                    <span className="h-1.5 w-8 rounded-full bg-[var(--color-text-highlight)]/12" />
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold text-[var(--color-text-highlight)]">
                        {accent.label}
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
                      className="relative shrink-0 text-[var(--color-text-highlight)]"
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
        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.appearanceSection.intensity")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.appearanceSection.intensityDescription")}
            </span>
          </div>
          <Select
            value={intensity}
            onChange={(value) => onIntensityChange(value as GlassIntensity)}
            className="w-[140px] shrink-0"
            options={[
              { value: "light", label: "Light" },
              { value: "medium", label: "Medium" },
              { value: "heavy", label: "Heavy" },
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5">
          <div className="min-w-0 pr-2">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.appearanceSection.liquid")}
            </span>
            <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("settings.appearanceSection.liquidDescription")}
            </p>
          </div>
          <Switch
            checked={liquidTexture}
            onCheckedChange={onLiquidTextureChange}
            aria-label={t("settings.appearanceSection.liquidLabel")}
          />
        </div>
      </GlassContainer>
    </div>
  );
}
