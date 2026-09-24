import { useLocale } from "../../Foundation/I18n";

/** 编辑器字号档位：映射 editorFontSize 设置（px），默认 14 与设置页一致 */
export type EditorFontSizeChoice = 12 | 14 | 16;
/** 行高档位：映射 editorLineHeight 设置（px），默认 24 与设置页一致 */
export type EditorLineHeightChoice = 20 | 24 | 28;
/** 玻璃强度档位：与外观设置同源（useGlassStore.intensity 为 0-100 连续值，三档取锚点） */
export type GlassStrengthChoice = 0 | 50 | 100;

interface PreferenceOption<T extends string | number> {
  id: T;
  label: string;
  /** 辅助说明（字号/行高档位显示 px 值；玻璃强度档位改用 level 指示点） */
  hint?: string;
  /** 玻璃强度档位专属：强度指示点数量（1-3） */
  level?: number;
}

/** 单组偏好：标题 + 三选一卡片，选中态与主题/语言卡一致（accent 染底 + mix 细描边 + ring 光晕）。 */
function PreferenceGroup<T extends string | number>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Array<PreferenceOption<T>>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-[var(--color-text-highlight)]">{title}</span>
      <div className="grid grid-cols-3 gap-2.5">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              type="button"
              key={String(option.id)}
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-control border px-3 py-2.5 text-center transition-all duration-150 ${
                selected
                  ? "border-transparent bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--material-surface))] shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--color-accent)_55%,transparent),0_6px_18px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
                  : "border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-text-muted)] hover:border-[var(--border-overlay)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
              }`}
            >
              <span
                className={`text-[13px] font-medium ${
                  selected ? "text-[var(--color-text-highlight)]" : ""
                }`}
              >
                {option.label}
              </span>
              {option.level ? (
                // 玻璃强度档位指示点：实心数量代表强度档位
                <span className="flex items-center gap-1">
                  {[1, 2, 3].map((dot) => (
                    <span
                      key={dot}
                      className={`size-1.5 rounded-full ${
                        dot <= (option.level ?? 0)
                          ? selected
                            ? "bg-[var(--color-accent)]"
                            : "bg-[var(--color-text-muted)]"
                          : selected
                            ? "bg-[var(--color-text-muted)]/25"
                            : "bg-[var(--color-text-muted)]/20"
                      }`}
                    />
                  ))}
                </span>
              ) : (
                <span
                  className={`text-[11px] leading-none ${
                    selected ? "text-[var(--color-text-muted)]" : "opacity-70"
                  }`}
                >
                  {option.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 步骤五：编辑器偏好（字号 / 行高 / 玻璃强度）。
 * 三组均为三选一，默认值已预选，可直接跳过；偏好于 OOBE 完成时统一应用。
 */
export function EditorPreferencesStep({
  fontSize,
  lineHeight,
  glassStrength,
  onFontSizeChange,
  onLineHeightChange,
  onGlassStrengthChange,
}: {
  fontSize: EditorFontSizeChoice;
  lineHeight: EditorLineHeightChoice;
  glassStrength: GlassStrengthChoice;
  onFontSizeChange: (next: EditorFontSizeChoice) => void;
  onLineHeightChange: (next: EditorLineHeightChoice) => void;
  onGlassStrengthChange: (next: GlassStrengthChoice) => void;
}) {
  const { t } = useLocale();

  const fontSizeOptions: Array<PreferenceOption<EditorFontSizeChoice>> = [
    { id: 12, label: t("oobe.prefFontSmall"), hint: "12px" },
    { id: 14, label: t("oobe.prefFontMedium"), hint: "14px" },
    { id: 16, label: t("oobe.prefFontLarge"), hint: "16px" },
  ];
  const lineHeightOptions: Array<PreferenceOption<EditorLineHeightChoice>> = [
    { id: 20, label: t("oobe.prefLineHeightCompact"), hint: "20px" },
    { id: 24, label: t("oobe.prefLineHeightDefault"), hint: "24px" },
    { id: 28, label: t("oobe.prefLineHeightRelaxed"), hint: "28px" },
  ];
  // 玻璃强度标签与外观设置共用同一组文案（轻透/均衡/醇厚），锚点 0/50/100，level 用于档位指示点
  const glassOptions: Array<PreferenceOption<GlassStrengthChoice>> = [
    { id: 0, label: t("settings.appearanceSection.intensityLight"), level: 1 },
    { id: 50, label: t("settings.appearanceSection.intensityMedium"), level: 2 },
    { id: 100, label: t("settings.appearanceSection.intensityHeavy"), level: 3 },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-bold tracking-tight text-[var(--color-text-highlight)]">
          {t("oobe.prefTitle")}
        </h1>
        <p className="text-[12.5px] leading-5 text-[var(--color-text-muted)]">
          {t("oobe.prefDesc")}
        </p>
      </div>
      <div className="flex flex-col gap-5">
        <PreferenceGroup
          title={t("oobe.prefFontSize")}
          options={fontSizeOptions}
          value={fontSize}
          onChange={onFontSizeChange}
        />
        <PreferenceGroup
          title={t("oobe.prefLineHeight")}
          options={lineHeightOptions}
          value={lineHeight}
          onChange={onLineHeightChange}
        />
        <PreferenceGroup
          title={t("oobe.prefGlass")}
          options={glassOptions}
          value={glassStrength}
          onChange={onGlassStrengthChange}
        />
      </div>
    </div>
  );
}
