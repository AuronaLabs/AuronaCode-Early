import { ACCENT_THEMES } from "../../App/ThemeAccent";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import type { AccentThemeId } from "../../Foundation/Types/Config";
import { Badge } from "../../UI/Components/Badge";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { Slider } from "../../UI/Components/Slider";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

interface AppearanceSettingsSectionProps {
  accentTheme: AccentThemeId;
  /** Aurona 玻璃强度连续值 0-100（0 轻透 / 50 均衡 / 100 醇厚锚点） */
  intensity: number;
  liquidTexture: boolean;
  boldText: boolean;
  interfaceFontSize: "compact" | "default" | "comfortable" | "large";
  onAccentThemeChange: (accent: AccentThemeId) => void;
  /** 拖动中实时回调（连续值，即时应用到玻璃材质） */
  onIntensityChange: (intensity: number) => void;
  /** 松手提交（值稳定，用于持久化） */
  onIntensityCommit: (intensity: number) => void;
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
  onIntensityCommit,
  onLiquidTextureChange,
  onBoldTextChange,
  onInterfaceFontSizeChange,
}: AppearanceSettingsSectionProps) {
  const { t } = useLocale();
  const themeLabel = (id: AccentThemeId) => t(`settings.themes.${id}` as I18nKey);
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

      <GlassContainer layer="raised" className="overflow-hidden">
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
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {ACCENT_THEMES.map((accent) => {
              const selected = accentTheme === accent.id;
              const tint = `rgb(${accent.rgb})`;
              return (
                <button
                  type="button"
                  key={accent.id}
                  aria-pressed={selected}
                  onClick={() => onAccentThemeChange(accent.id)}
                  className={`group relative flex flex-col items-stretch gap-1.5 overflow-hidden rounded-surface border p-1.5 pb-1 text-left backdrop-blur-[var(--glass-blur-raised)] transition-[border-color,box-shadow,transform,background-color] duration-200 ${
                    selected
                      ? "-translate-y-px border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--color-accent)_55%,transparent),0_0_24px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
                      : "border-transparent bg-[var(--material-surface)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--GlassSurface-Rim)_72%,transparent),inset_0_1px_0_var(--GlassSurface-Rim)] hover:-translate-y-px hover:bg-[var(--material-interactive-hover)] hover:shadow-[inset_0_0_0_1px_var(--GlassSurface-Rim),inset_0_1px_0_var(--GlassSurface-Rim)]"
                  }`}
                  style={
                    selected
                      ? {
                          backgroundColor: `color-mix(in srgb, ${tint} 14%, var(--material-surface))`,
                        }
                      : undefined
                  }
                >
                  {/* 玻璃染色预览：主题 accent 从玻璃里透出来，替代旧渐变位图 */}
                  <span
                    aria-hidden="true"
                    className="glass-layer-overlay relative block h-11 w-full overflow-hidden rounded-control border border-[var(--border-subtle)] bg-[var(--material-overlay)] backdrop-blur-[var(--glass-blur-overlay)] backdrop-saturate-[var(--GlassSaturation)]"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${tint} 20%, var(--material-overlay))`,
                    }}
                  >
                    <span
                      className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full shadow-[0_1px_4px_rgb(0_0_0/25%),inset_0_1px_1px_rgba(255,255,255,0.5)]"
                      style={{ backgroundColor: tint }}
                    />
                    <span className="absolute bottom-1.5 left-2.5 h-1 w-9 rounded-full bg-[color-mix(in_srgb,rgb(var(--AccentPrimary))_55%,transparent)]" />
                    <span className="absolute bottom-3.5 left-2.5 h-1 w-14 rounded-full bg-[var(--color-text-highlight)]/25" />
                    <span
                      className={`absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-white shadow-sm transition-opacity ${
                        selected ? "opacity-100" : "opacity-0"
                      }`}
                      style={{ backgroundColor: tint }}
                    >
                      <Icons.Check size={10} stroke={3} />
                    </span>
                  </span>
                  <span className="flex min-w-0 items-center justify-center gap-1 pb-0.5">
                    <span
                      className={`truncate text-[10.5px] font-semibold ${
                        selected
                          ? "text-[var(--color-text-highlight)]"
                          : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)]"
                      }`}
                    >
                      {themeLabel(accent.id)}
                    </span>
                    {accent.isDefault && (
                      <Badge className="px-1.5 py-px">
                        {t("settings.appearanceSection.defaultBadge")}
                      </Badge>
                    )}
                  </span>
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

      <GlassContainer layer="raised" className="overflow-hidden">
        <div data-setting-id="materialIntensity" className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.appearanceSection.intensity")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.appearanceSection.intensityDescription")}
            </span>
          </div>
          <div className="w-[220px] shrink-0">
            <Slider
              value={intensity}
              onValueChange={onIntensityChange}
              onValueCommit={onIntensityCommit}
              min={0}
              max={100}
              step={1}
              ariaLabel={t("settings.appearanceSection.intensity")}
              marks={[
                { value: 0, label: t("settings.appearanceSection.intensityLight") },
                { value: 50, label: t("settings.appearanceSection.intensityMedium") },
                { value: 100, label: t("settings.appearanceSection.intensityHeavy") },
              ]}
            />
          </div>
        </div>
        <div
          data-setting-id="liquidTexture"
          className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="min-w-0 pr-2">
            <span className="flex items-center gap-2">
              <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
                {t("settings.appearanceSection.liquid")}
              </span>
              <Badge>Beta</Badge>
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
