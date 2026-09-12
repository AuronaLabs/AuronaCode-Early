import { useLocale } from "../../Foundation/I18n";
import { Button } from "../../UI/Components/Button";
import { Icons } from "../../UI/Icons/IconManager";

/**
 * 结束页：对标系统级 OOBE 的完成欢迎页，以勾徽章收束整个引导流程。
 * CTA 直接置于内容中央，点击进入工作台。
 */
export function ReadyStep({ onFinish, finishing }: { onFinish: () => void; finishing: boolean }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div className="relative">
        <div className="oobe-ready-halo" />
        <div className="oobe-ready-pop relative grid size-24 place-items-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-hover)] shadow-[0_18px_50px_color-mix(in_srgb,var(--color-accent)_40%,transparent)]">
          <Icons.Check size={44} stroke={2.5} className="text-white" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <h1 className="text-[32px] font-bold tracking-tight text-[var(--color-text-highlight)]">
          {t("oobe.readyTitle")}
        </h1>
        <p className="max-w-[460px] text-[14.5px] leading-7 text-[var(--color-text-muted)]">
          {t("oobe.readyDesc")}
        </p>
      </div>
      <Button size="lg" className="group min-w-[220px]" disabled={finishing} onClick={onFinish}>
        <Icons.Sparkles size={16} />
        {t("oobe.finish")}
        <Icons.ArrowRight
          size={15}
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Button>
    </div>
  );
}
