import { useCallback, useEffect, useState } from "react";
import { desktopApp, desktopWindow } from "../../Foundation/Desktop";
import { type Locale, LocaleService, useLocale } from "../../Foundation/I18n";
import { formatDisplayVersion } from "../../Foundation/Release/ReleaseChannel";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { TitleBar } from "../../Layout/TitleBar/TitleBar";
import { Button } from "../../UI/Components/Button";
import { Icons } from "../../UI/Icons/IconManager";
import { AccountStep } from "./AccountStep";
import { LanguageStep } from "./LanguageStep";
import { ReadyStep } from "./ReadyStep";
import { type ThemeChoice, ThemeStep } from "./ThemeStep";
import { useOobeStore } from "./useOobeStore";
import { WelcomeStep } from "./WelcomeStep";
import "./Oobe.css";

const TOTAL_STEPS = 5;
const STEP_IDS = [0, 1, 2, 3, 4];

/**
 * 欢迎引导覆盖层：主窗口内的全屏置顶界面（首次运行自动呈现，高级设置可重游）。
 * 无二级卡片，步骤内容直接呈现在应用背景上；顶部栏与主程序统一（隐藏菜单项），
 * 语言/主题选择即时生效，账户登录可跳过。
 */
export function OobeOverlay() {
  const { t, locale } = useLocale();
  const mode = useOobeStore((state) => state.mode);
  const closeOobe = useOobeStore((state) => state.close);
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [version, setVersion] = useState<string>("");
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    desktopApp
      .getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  // 界面语言同步至 html lang，保证辅助技术与字体回退正确
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // 主题预览：覆盖层与底层工作台共用 document，选择即时反映到整套界面
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const finish = useCallback(async () => {
    setFinishing(true);
    try {
      await UserConfigStore.set({ theme });
    } finally {
      setFinishing(false);
      closeOobe();
    }
  }, [theme, closeOobe]);

  const selectLanguage = useCallback((next: Locale) => {
    // 语言写入 localStorage 后全局订阅者（含底层工作台）即刻响应
    LocaleService.set(next);
  }, []);

  // 首次运行中关闭引导 = 退出应用（主窗口是唯一窗口）；重游模式下仅收起覆盖层
  const handleClose = useCallback(() => {
    if (mode === "first-run") {
      void desktopWindow.close();
      return;
    }
    closeOobe();
  }, [mode, closeOobe]);

  if (!mode) return null;

  return (
    <div className="oobe-backdrop fixed inset-0 z-[999] flex flex-col overflow-hidden select-none">
      <div className="oobe-ambient" />

      {/* 与主程序统一的标题栏：隐藏菜单项与工作台入口，仅保留品牌与窗口控制 */}
      <div className="relative z-30">
        <TitleBar showMenus={false} onClose={handleClose} />
      </div>

      {/* 步骤内容：直接呈现在应用背景上，无二级卡片 */}
      <main className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-10">
        <div key={step} className="oobe-step-enter flex w-full justify-center">
          {step === 0 && <WelcomeStep version={version ? formatDisplayVersion(version) : ""} />}
          {step === 1 && (
            <div className="w-full max-w-[680px]">
              <LanguageStep onSelect={selectLanguage} />
            </div>
          )}
          {step === 2 && (
            <div className="w-full max-w-[680px]">
              <ThemeStep theme={theme} onChange={setTheme} />
            </div>
          )}
          {step === 3 && (
            <div className="w-full max-w-[460px]">
              <AccountStep onSkip={() => setStep((prev) => prev + 1)} />
            </div>
          )}
          {step === 4 && <ReadyStep onFinish={() => void finish()} finishing={finishing} />}
        </div>
      </main>

      {/* 底部导航：步骤圆点 + 统一的上一步/下一步，直接置于背景之上 */}
      <footer className="relative z-10 flex shrink-0 items-center justify-between px-9 pb-7">
        <div className="flex min-w-[104px] items-center gap-1.5">
          {STEP_IDS.map((stepId) => (
            <span
              key={stepId}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                stepId === step
                  ? "w-6 bg-[var(--color-accent)]"
                  : "w-1.5 bg-[var(--color-text-muted)]/35"
              }`}
            />
          ))}
        </div>
        <div className="flex min-w-[104px] items-center justify-end gap-2.5">
          {step > 0 && (
            <Button variant="ghost" size="lg" onClick={() => setStep((prev) => prev - 1)}>
              <Icons.ChevronLeft size={15} />
              {t("oobe.back")}
            </Button>
          )}
          {step < TOTAL_STEPS - 1 && (
            <Button
              size="lg"
              className="group min-w-[112px]"
              onClick={() => setStep((prev) => prev + 1)}
            >
              {t("oobe.next")}
              <Icons.ArrowRight
                size={15}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
