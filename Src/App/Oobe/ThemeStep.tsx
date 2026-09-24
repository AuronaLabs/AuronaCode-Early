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
                // 选中态与设置页主题卡同一语言：accent 液态光环（.glass-card-selected
                // 定义于 Theme.css，源序覆盖玻璃层默认描边）
                selected ? "glass-card-selected cursor-default" : ""
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

/**
 * 主题卡片的迷你预览块：局部变量作用域快照。
 * 预览卡不再读取全局明暗变量（--material-* 等会随整体主题联动，导致三卡永远同相），
 * 而是由 data-oobe-preview 属性注入自包含调色板（见 Oobe.css）；
 * accent 是明暗无关令牌，继续跟随用户强调色，保证与整体选色一致。
 * system 卡拆成左右两半（半明半暗），各自经局部变量独立渲染。
 */
function ThemePreview({ choice }: { choice: ThemeChoice }) {
  if (choice === "system") {
    return (
      <div
        data-oobe-preview="light"
        className="oobe-theme-preview relative flex h-[72px] w-full overflow-hidden rounded-surface"
      >
        <div className="oobe-theme-preview-scene h-full w-1/2">
          <PreviewScene />
        </div>
        <div className="oobe-theme-preview-scene h-full w-1/2" data-oobe-preview="dark">
          <PreviewScene />
        </div>
      </div>
    );
  }
  return (
    <div
      data-oobe-preview={choice}
      className="oobe-theme-preview relative h-[72px] w-full overflow-hidden rounded-surface"
    >
      <PreviewScene />
    </div>
  );
}

/** 预览内的小场景：accent 色滴 + 两行示意文字 + 右下迷你面板，颜色全部取自局部变量。 */
function PreviewScene() {
  return (
    <div className="relative h-full w-full">
      <span className="absolute top-2.5 left-2.5 h-2.5 w-10 rounded-full bg-[var(--oobe-pv-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" />
      <span className="absolute top-7 left-2.5 h-1.5 w-14 rounded-full bg-[var(--oobe-pv-line-strong)]" />
      <span className="absolute top-10.5 left-2.5 h-1.5 w-10 rounded-full bg-[var(--oobe-pv-line-soft)]" />
      <span className="absolute right-2.5 bottom-2.5 h-8 w-12 rounded-md border border-[var(--oobe-pv-border)] bg-[var(--oobe-pv-panel)] shadow-[inset_0_1px_0_var(--oobe-pv-rim)]" />
    </div>
  );
}
