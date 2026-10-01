import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApp, desktopWindow } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { type Locale, LocaleService, useLocale } from "../../Foundation/I18n";
import { formatDisplayVersion } from "../../Foundation/Release/ReleaseChannel";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { TitleBar } from "../../Layout/TitleBar/TitleBar";
import { Button } from "../../UI/Components/Button";
import { useGlassStore } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { AccountStep } from "./AccountStep";
import {
  type EditorFontSizeChoice,
  type EditorLineHeightChoice,
  EditorPreferencesStep,
  type GlassStrengthChoice,
} from "./EditorPreferencesStep";
import { LanguageStep } from "./LanguageStep";
import { ReadyStep } from "./ReadyStep";
import { type ThemeChoice, ThemeStep } from "./ThemeStep";
import { useOobeStore } from "./useOobeStore";
import { WelcomeStep } from "./WelcomeStep";
import "./Oobe.css";

const TOTAL_STEPS = 6;
const STEP_IDS = [0, 1, 2, 3, 4, 5];
const STEP_LABELS = [
  "oobe.welcomeTitle",
  "oobe.languageTitle",
  "oobe.themeTitle",
  "oobe.prefTitle",
  "oobe.accountTitle",
  "oobe.readyTitle",
] as const;

/**
 * 欢迎引导覆盖层：主窗口内的全屏置顶界面（首次运行自动呈现，高级设置可重游）。
 * 无二级卡片，步骤内容直接呈现在应用背景上；顶部栏与主程序统一（隐藏菜单项），
 * 语言/主题选择即时生效，账户登录可跳过，编辑器偏好于完成时统一应用。
 */
export function OobeOverlay() {
  const { t, locale } = useLocale();
  const mode = useOobeStore((state) => state.mode);
  const closeOobe = useOobeStore((state) => state.close);
  const setGlassIntensity = useGlassStore((state) => state.setIntensity);
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  // 编辑器偏好：默认值与设置页一致（14px / 24px / 均衡=50），保持默认即可直接跳过
  const [editorFontSize, setEditorFontSize] = useState<EditorFontSizeChoice>(14);
  const [editorLineHeight, setEditorLineHeight] = useState<EditorLineHeightChoice>(24);
  const [glassStrength, setGlassStrength] = useState<GlassStrengthChoice>(50);
  const [version, setVersion] = useState<string>("");
  const [finishing, setFinishing] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const initialLocaleRef = useRef(locale);
  const originalRef = useRef<{
    locale: Locale;
    themeClass: boolean;
    editorFontSize: number;
    editorLineHeight: number;
    glassStrength: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void UserConfigStore.get().then((config) => {
      if (cancelled) return;
      const savedFont = config.editorFontSize ?? 14;
      const savedLineHeight = config.editorLineHeight ?? 24;
      const savedGlass = useGlassStore.getState().intensity;
      originalRef.current = {
        locale: initialLocaleRef.current,
        themeClass: document.documentElement.classList.contains("dark"),
        editorFontSize: savedFont,
        editorLineHeight: savedLineHeight,
        glassStrength: savedGlass,
      };
      setTheme(config.theme ?? "system");
      setEditorFontSize(savedFont as EditorFontSizeChoice);
      setEditorLineHeight(savedLineHeight as EditorLineHeightChoice);
      setGlassStrength(savedGlass as GlassStrengthChoice);
      setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!draftReady) return;
    setFinishing(true);
    try {
      // 主题与编辑器偏好统一在此落盘（与设置页复用相同字段与默认值）
      await UserConfigStore.set({
        theme,
        locale,
        editorFontSize,
        editorLineHeight,
        appearance: { glassIntensity: glassStrength },
      });
      // 编辑器排版即时生效（CSS 变量），并通知已打开的编辑器重读设置（重游场景）
      document.documentElement.style.setProperty("--EditorFontSize", `${editorFontSize}px`);
      document.documentElement.style.setProperty("--EditorLineHeight", `${editorLineHeight}px`);
      EventBus.emit("settings:editor-changed");
      // 玻璃强度走独立玻璃商店（持久化 + DOM 令牌应用）
      setGlassIntensity(glassStrength);
      closeOobe();
    } catch (error) {
      showToast(
        LocaleService.translate("settings.toast.saveFailed").replace("{message}", String(error)),
        "error",
      );
    } finally {
      setFinishing(false);
    }
  }, [
    draftReady,
    theme,
    locale,
    editorFontSize,
    editorLineHeight,
    glassStrength,
    setGlassIntensity,
    closeOobe,
  ]);

  const selectLanguage = useCallback((next: Locale) => {
    // 语言写入 localStorage 后全局订阅者（含底层工作台）即刻响应
    LocaleService.syncFromConfig(next);
  }, []);

  const cancelDraft = useCallback(() => {
    const original = originalRef.current;
    if (original) {
      LocaleService.syncFromConfig(original.locale);
      document.documentElement.classList.toggle("dark", original.themeClass);
      document.documentElement.style.setProperty(
        "--EditorFontSize",
        `${original.editorFontSize}px`,
      );
      document.documentElement.style.setProperty(
        "--EditorLineHeight",
        `${original.editorLineHeight}px`,
      );
      setGlassIntensity(original.glassStrength);
    }
    closeOobe();
  }, [closeOobe, setGlassIntensity]);

  // 首次运行中关闭引导 = 退出应用（主窗口是唯一窗口）；重游模式下仅收起覆盖层
  const handleClose = useCallback(() => {
    if (mode === "first-run") {
      void desktopWindow.close();
      return;
    }
    cancelDraft();
  }, [mode, cancelDraft]);

  if (!mode) return null;

  return (
    <div className="oobe-backdrop fixed inset-0 z-[999] flex flex-col overflow-hidden select-none">
      <div className="oobe-ambient" />

      {/* 与主程序统一的标题栏：隐藏菜单项与工作台入口，仅保留品牌与窗口控制 */}
      <div className="relative z-30">
        <TitleBar showMenus={false} onClose={handleClose} />
      </div>

      {/* 步骤内容：直接呈现在应用背景上，无二级卡片 */}
      <div className="oobe-progress relative z-10 px-5 pt-3 sm:px-9">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            {step + 1} / {TOTAL_STEPS}
          </span>
          <span className="truncate text-[12px] font-medium text-[var(--color-text-highlight)]">
            {t(STEP_LABELS[step])}
          </span>
        </div>
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-text-muted)]/15"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-valuenow={step + 1}
        >
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
            style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>
      <main className="relative z-10 flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-5 py-6 sm:items-center sm:px-10 sm:py-8">
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
            <div className="w-full max-w-[560px]">
              <EditorPreferencesStep
                fontSize={editorFontSize}
                lineHeight={editorLineHeight}
                glassStrength={glassStrength}
                onFontSizeChange={setEditorFontSize}
                onLineHeightChange={setEditorLineHeight}
                onGlassStrengthChange={setGlassStrength}
              />
            </div>
          )}
          {step === 4 && (
            <div className="w-full max-w-[460px]">
              <AccountStep
                onSkip={() => setStep((prev) => prev + 1)}
                onContinue={() => setStep((prev) => prev + 1)}
              />
            </div>
          )}
          {step === 5 && (
            <ReadyStep onFinish={() => void finish()} finishing={finishing || !draftReady} />
          )}
        </div>
      </main>

      {/* 底部导航：步骤圆点 + 统一的上一步/下一步，直接置于背景之上 */}
      <footer className="relative z-10 flex shrink-0 items-center justify-between gap-4 px-5 pb-5 sm:px-9 sm:pb-7">
        <div className="flex min-w-0 items-center gap-1.5" aria-hidden="true">
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
          {step < TOTAL_STEPS - 1 && step !== 4 && (
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
