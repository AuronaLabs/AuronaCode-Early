import { type I18nKey, LOCALE_NATIVE_NAMES, type Locale, useLocale } from "../../Foundation/I18n";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

/** OOBE 的语言选项：native 固定以各自母语展示（不参与翻译），sub 为当前界面语言下的辅助说明。 */
const LANGUAGE_OPTIONS: Array<{ id: Locale; sub: I18nKey }> = [
  { id: "zh-CN", sub: "settings.languageZhCN" },
  { id: "zh-Hant", sub: "settings.languageZhHant" },
  { id: "en", sub: "settings.languageEn" },
  { id: "de", sub: "settings.languageDe" },
  { id: "it", sub: "settings.languageIt" },
  { id: "ja", sub: "settings.languageJa" },
];

/** 步骤二：界面语言选择，选择即刻生效。 */
export function LanguageStep({ onSelect }: { onSelect: (next: Locale) => void }) {
  const { t, locale } = useLocale();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-bold tracking-tight text-[var(--color-text-highlight)]">
          {t("oobe.languageTitle")}
        </h1>
        <p className="text-[12.5px] leading-5 text-[var(--color-text-muted)]">
          {t("oobe.languageDesc")}
        </p>
      </div>
      <div className="flex flex-col gap-2.5">
        {LANGUAGE_OPTIONS.map((option) => {
          const selected = locale === option.id;
          return (
            <GlassContainer
              key={option.id}
              layer="base"
              interactive={!selected}
              role="button"
              aria-pressed={selected}
              onClick={() => onSelect(option.id)}
              className={`flex cursor-pointer items-center justify-between p-4 text-left transition-shadow duration-150 ${
                selected
                  ? "cursor-default shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--color-accent)_55%,transparent),0_8px_24px_rgb(0_0_0/20%)]"
                  : ""
              }`}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[14.5px] font-semibold text-[var(--color-text-highlight)]">
                  {LOCALE_NATIVE_NAMES[option.id]}
                </span>
                <span className="text-[11.5px] text-[var(--color-text-muted)]">
                  {t(option.sub)}
                </span>
              </span>
              {selected && (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-[0_2px_8px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]">
                  <Icons.Check size={13} />
                </span>
              )}
            </GlassContainer>
          );
        })}
      </div>
    </div>
  );
}
