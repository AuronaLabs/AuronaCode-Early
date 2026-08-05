import { ACCENT_THEMES } from "../../App/ThemeAccent";
import type { AccentThemeId } from "../../Foundation/Types/Config";
import { Select } from "../../UI/Components/Select";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer, type GlassIntensity } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

interface AppearanceSettingsSectionProps {
  theme: "light" | "dark" | "system";
  accentTheme: AccentThemeId;
  intensity: GlassIntensity;
  liquidTexture: boolean;
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  onAccentThemeChange: (accent: AccentThemeId) => void;
  onIntensityChange: (intensity: GlassIntensity) => void;
  onLiquidTextureChange: (enabled: boolean) => void;
}

export function AppearanceSettingsSection({
  theme,
  accentTheme,
  intensity,
  liquidTexture,
  onThemeChange,
  onAccentThemeChange,
  onIntensityChange,
  onLiquidTextureChange,
}: AppearanceSettingsSectionProps) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">外观与色彩</h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          在同一处调整界面模式、工作台色彩与背景氛围
        </p>
      </div>

      <GlassContainer layer="elevated" className="overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              外观模式
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              更改编辑器的整体色彩倾向
            </span>
          </div>
          <fieldset className="grid w-full grid-cols-3 gap-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--material-panel)] p-1.5 shadow-[inset_0_1px_1px_var(--material-inset)] backdrop-blur-[var(--glass-blur-base)] sm:w-auto">
            <legend className="sr-only">外观模式</legend>
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                type="button"
                aria-pressed={theme === t}
                key={t}
                onClick={() => onThemeChange(t)}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 sm:min-w-[104px] ${
                  theme === t
                    ? "border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)] backdrop-blur-[var(--glass-blur-elevated)]"
                    : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
                }`}
              >
                {t === "system" && (
                  <>
                    <Icons.Monitor size={16} /> 跟随系统
                  </>
                )}
                {t === "light" && (
                  <>
                    <Icons.Sun size={16} /> 浅色
                  </>
                )}
                {t === "dark" && (
                  <>
                    <Icons.Moon size={16} /> 深色
                  </>
                )}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="border-t border-[var(--border-subtle)] p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-1 px-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              色彩主题
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              八套主题各自拥有完整的浅色/深色背景渐变设计，统一影响交互强调、焦点与状态反馈
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
                          默认
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
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">视觉效果</h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          调整界面元素的玻璃拟物（毛玻璃）效果强度与动态质感
        </p>
      </div>

      <GlassContainer layer="elevated" className="overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              拟物强度
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              同步控制毛玻璃模糊、透明度以及菜单/卡片的阴影厚度
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
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">流光</span>
            <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-text-muted)]">
              一条极低透明度的柔和光带缓慢扫过窗口，不跟随鼠标，也不在卡片上叠加高亮
            </p>
          </div>
          <Switch
            checked={liquidTexture}
            onCheckedChange={onLiquidTextureChange}
            aria-label="启用流光"
          />
        </div>
      </GlassContainer>
    </div>
  );
}
