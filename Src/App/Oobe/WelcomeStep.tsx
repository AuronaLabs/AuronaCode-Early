import { useLocale } from "../../Foundation/I18n";

/** 步骤一：欢迎页。品牌 hero + 版本徽标。 */
export function WelcomeStep({ version }: { version: string }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="relative">
        <div className="oobe-logo-halo" />
        <img
          src="/logo.png"
          alt=""
          className="relative h-24 w-24 rounded-3xl shadow-[0_16px_48px_rgb(0_0_0/38%)]"
        />
      </div>
      <div className="flex flex-col gap-3">
        <h1 className="text-[32px] font-bold tracking-tight text-[var(--color-text-highlight)]">
          {t("oobe.welcomeTitle")}
        </h1>
        <p className="max-w-[480px] text-[14.5px] leading-7 text-[var(--color-text-muted)]">
          {t("oobe.welcomeDesc")}
        </p>
      </div>
      {version && (
        <span
          className="rounded-control border border-[var(--border-subtle)] bg-[var(--material-panel)] px-2.5 py-1 text-[11px] font-medium tracking-[0.08em] text-[var(--color-text-muted)]"
          style={{ fontFamily: '"JetBrains Mono", monospace' }}
        >
          {version}
        </span>
      )}
    </div>
  );
}
