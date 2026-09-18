import { useLocale } from "../../Foundation/I18n";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

export type ThemeChoice = "light" | "dark" | "system";

/** 步骤三：外观主题选择，卡片内提供玻璃染色迷你预览，选择即时预览。 */
export function ThemeStep({
  theme,
  onChange,
}: {
  theme: ThemeChoice;
  onChange: (next: ThemeChoice) => void;
}) {
  const { t } = useLocale();
  const options = [
    { id: "light", label: t("oobe.themeLight"), icon: <Icons.Sun size={15} /> },
    { id: "dark", label: t("oobe.themeDark"), icon: <Icons.Moon size={15} /> },
    { id: "system", label: t("oobe.themeSystem"), icon: <Icons.Monitor size={15} /> },
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-bold tracking-tight text-[var(--color-text-highlight)]">
          {t("oobe.themeTitle")}
        </h1>
        <p className="text-[12.5px] leading-5 text-[var(--color-text-muted)]">
          {t("oobe.themeDesc")}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {options.map((option) => {
          const selected = theme === option.id;
          return (
            <GlassContainer
              key={option.id}
              layer="base"
              interactive={!selected}
              role="button"
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
              className={`group flex cursor-pointer flex-col gap-2.5 p-3 transition-shadow duration-150 ${
                selected
                  ? "cursor-default shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--color-accent)_55%,transparent),0_8px_24px_rgb(0_0_0/20%),inset_0_1px_0_var(--GlassSurface-Rim)]"
                  : ""
              }`}
            >
              <ThemePreview choice={option.id} />
              <span className="flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-[var(--color-text-highlight)]">
                {option.icon}
                {option.label}
              </span>
            </GlassContainer>
          );
        })}
      </div>
    </div>
  );
}

/** 主题卡片的迷你预览块：玻璃染色示意对应外观（明暗决定玻璃通透，accent 点为色滴）。 */
function ThemePreview({ choice }: { choice: ThemeChoice }) {
  return (
    <div className="glass-layer-overlay h-[72px] w-full overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--material-overlay)] backdrop-blur-[var(--glass-blur-overlay)] backdrop-saturate-[var(--GlassSaturation)]">
      <div className="relative h-full w-full">
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
          <span className="h-2.5 w-10 rounded-full bg-[var(--color-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" />
          {choice === "system" && (
            <>
              <Icons.Sun size={11} className="text-[var(--color-text-highlight)]/70" />
              <Icons.Moon size={11} className="text-[var(--color-text-highlight)]/45" />
            </>
          )}
        </div>
        <div className="absolute top-7 left-2.5 h-1.5 w-14 rounded-full bg-[var(--color-text-highlight)]/25" />
        <div className="absolute top-10.5 left-2.5 h-1.5 w-10 rounded-full bg-[var(--color-text-highlight)]/15" />
        <div className="absolute right-2.5 bottom-2.5 h-8 w-12 rounded-md border border-[var(--border-subtle)] bg-[var(--material-surface)] shadow-[inset_0_1px_0_var(--GlassSurface-Rim)]" />
      </div>
    </div>
  );
}
