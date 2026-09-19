import { useLocale } from "../../Foundation/I18n";
import { Button } from "../../UI/Components/Button";
import { Icons } from "../../UI/Icons/IconManager";

/**
 * 结束页：对标系统级 OOBE 的完成欢迎页，以克制的柔光 + 勾徽章收束整个引导流程。
 * CTA 直接置于内容中央，点击进入工作台。
 */
export function ReadyStep({ onFinish, finishing }: { onFinish: () => void; finishing: boolean }) {
  const { t } = useLocale();
  return (
    <div className="relative flex flex-col items-center gap-7 text-center">
      {/* 多层柔和光晕：accent 大半径低透明度，缓慢呼吸（见 Oobe.css） */}
      <div aria-hidden="true" className="oobe-ready-glow" />
      {/* 中央成功徽章：玻璃圆容器 + accent 对勾，入场 scale+fade */}
      <div className="oobe-ready-pop relative grid size-20 place-items-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_38%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--color-accent)_14%,var(--material-surface))] shadow-[inset_0_1px_0_var(--GlassSurface-Highlight),0_14px_40px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] backdrop-blur-[var(--glass-blur-raised)]">
        <Icons.Check size={36} stroke={2.5} className="text-[var(--color-accent)]" />
      </div>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[28px] font-bold tracking-tight text-[var(--color-text-highlight)]">
          {t("oobe.readyTitle")}
        </h1>
        <p className="max-w-[420px] text-[13.5px] leading-6 text-[var(--color-text-muted)]">
          {t("oobe.readyDesc")}
        </p>
      </div>
      <Button size="lg" className="group min-w-[200px]" disabled={finishing} onClick={onFinish}>
        {t("oobe.finish")}
        <Icons.ArrowRight
          size={15}
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Button>
    </div>
  );
}
