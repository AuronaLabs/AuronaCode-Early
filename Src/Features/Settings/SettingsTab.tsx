import { useEffect, useMemo, useRef, useState } from "react";
import { applyAccentTheme, applyLiquidTexture } from "../../App/ThemeAccent";
import {
  SETTING_CATEGORY_KEYS,
  type SettingCategory,
  searchSettings,
} from "../../Core/Settings/SettingRegistry";
import { UpdaterService } from "../../Core/UpdaterService";
import { CommandRegistry } from "../../Extension/CommandRegistry";
import { BaseDirectory, desktopFileSystem } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { type I18nKey, type Locale, useLocale } from "../../Foundation/I18n";
import { GitIPC } from "../../Foundation/IPC/GitCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import type { AccentThemeId } from "../../Foundation/Types/Config";
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { SettingsNavItem } from "../../UI/Components/SettingsNavItem";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer, useGlassStore } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { AccountSettings } from "./AccountSettings";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { DebugSettings } from "./DebugSettings";
import { LanguageServiceSettings } from "./LanguageServiceSettings";
import { StorageSettingsSection } from "./StorageSettingsSection";

export type SettingsSection =
  | "general"
  | "appearance"
  | "editor"
  | "codeIntelligence"
  | "terminalRun"
  | "sourceControl"
  | "accountCloud"
  | "system"
  | "advanced";

type Density = "compact" | "default" | "regular" | "comfortable";

const CATEGORY_TO_SECTION: Record<SettingCategory, SettingsSection> = {
  general: "general",
  appearance: "appearance",
  editor: "editor",
  codeIntelligence: "codeIntelligence",
  terminalRun: "terminalRun",
  sourceControl: "sourceControl",
  accountCloud: "accountCloud",
  system: "system",
  advanced: "advanced",
};

const SECTION_META: Array<{
  id: SettingsSection;
  labelKey: I18nKey;
  Icon: (typeof Icons)["Settings"];
}> = [
  { id: "general", labelKey: "settings.categories.general", Icon: Icons.Monitor },
  { id: "appearance", labelKey: "settings.categories.appearance", Icon: Icons.Palette },
  { id: "editor", labelKey: "settings.categories.editor", Icon: Icons.FileCode },
  {
    id: "codeIntelligence",
    labelKey: "settings.categories.codeIntelligence",
    Icon: Icons.Sparkles,
  },
  { id: "terminalRun", labelKey: "settings.categories.terminalRun", Icon: Icons.Terminal },
  { id: "sourceControl", labelKey: "settings.categories.sourceControl", Icon: Icons.Git },
  { id: "accountCloud", labelKey: "settings.categories.accountCloud", Icon: Icons.User },
  { id: "system", labelKey: "settings.categories.system", Icon: Icons.Database },
  { id: "advanced", labelKey: "settings.categories.advanced", Icon: Icons.Settings },
];

function applyDensity(next: Density) {
  const root = document.documentElement;
  if (next !== "default") {
    root.dataset.density = next;
    return;
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  if (width < 940 || height < 680 || dpr >= 1.75) {
    root.dataset.density = "compact";
  } else if (width > 1600 && height > 900 && dpr <= 1.25) {
    root.dataset.density = "comfortable";
  } else {
    root.dataset.density = "regular";
  }
}

export function SettingsTab() {
  const { locale, setLocale, t } = useLocale();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [revealTarget, setRevealTarget] = useState<{ settingId: string; nonce: number } | null>(
    null,
  );
  const revealTargetRef = useRef<number | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const intensity = useGlassStore((state) => state.intensity);
  const setIntensity = useGlassStore((state) => state.setIntensity);

  useEffect(() => {
    const unsub = EventBus.on("settings:nav", (section: SettingsSection) => {
      setActiveSection(section);
    });
    const unsubReveal = EventBus.on("settings:reveal", ({ category, settingId }) => {
      setActiveSection(CATEGORY_TO_SECTION[category]);
      if (settingId) setRevealTarget({ settingId, nonce: Date.now() });
    });
    return () => {
      unsub();
      unsubReveal();
    };
  }, []);

  useEffect(() => {
    if (!revealTarget) return;
    const element = document.querySelector<HTMLElement>(
      `[data-setting-id="${revealTarget.settingId}"]`,
    );
    if (!element) return;
    const frame = requestAnimationFrame(() => {
      element.scrollIntoView({ block: "center" });
      element.classList.add("setting-reveal-flash");
      const timer = window.setTimeout(() => {
        element.classList.remove("setting-reveal-flash");
      }, 1500);
      revealTargetRef.current = timer;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (revealTargetRef.current) window.clearTimeout(revealTargetRef.current);
      revealTargetRef.current = null;
      element.classList.remove("setting-reveal-flash");
    };
  }, [revealTarget]);

  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [accentTheme, setAccentTheme] = useState<AccentThemeId>("aurora");
  const [liquidTexture, setLiquidTexture] = useState(false);
  const [density, setDensity] = useState<Density>("default");
  const [boldText, setBoldText] = useState(false);
  const [interfaceFontSize, setInterfaceFontSize] = useState<
    "compact" | "default" | "comfortable" | "large"
  >("default");

  const [editorFontSize, setEditorFontSize] = useState("14");
  const [editorLineHeight, setEditorLineHeight] = useState("24");
  const [editorTabSize, setEditorTabSize] = useState("2");
  const [editorWordWrap, setEditorWordWrap] = useState("on");

  const [terminalFontSize, setTerminalFontSize] = useState("13");
  const [terminalCursorBlink, setTerminalCursorBlink] = useState("true");

  useEffect(() => {
    UserConfigStore.get().then((config) => {
      const savedTheme = config.theme as "light" | "dark" | "system" | undefined;
      if (savedTheme) setTheme(savedTheme);
      const savedAccent = config.accentTheme ?? "aurora";
      setAccentTheme(savedAccent);
      applyAccentTheme(savedAccent);
      const savedLiquidTexture = config.liquidTexture ?? false;
      setLiquidTexture(savedLiquidTexture);
      applyLiquidTexture(savedLiquidTexture);

      const savedDensity = (config.density ?? "default") as Density;
      setDensity(savedDensity);
      applyDensity(savedDensity);

      const savedBoldText = config.boldText ?? false;
      setBoldText(savedBoldText);
      if (savedBoldText) {
        document.documentElement.setAttribute("data-bold-text", "true");
      } else {
        document.documentElement.removeAttribute("data-bold-text");
      }

      const savedInterfaceFont = config.interfaceFontSize ?? "default";
      setInterfaceFontSize(savedInterfaceFont);
      if (savedInterfaceFont !== "default") {
        document.documentElement.setAttribute("data-font-size", savedInterfaceFont);
      } else {
        document.documentElement.removeAttribute("data-font-size");
      }

      const savedEditorFont = config.editorFontSize?.toString() || "14";
      const savedEditorLineHeight = config.editorLineHeight?.toString() || "24";
      const savedEditorTabSize = config.editorTabSize?.toString() || "2";
      const savedTerminalFont = config.terminalFontSize?.toString() || "13";
      setEditorFontSize(savedEditorFont);
      setEditorLineHeight(savedEditorLineHeight);
      setEditorTabSize(savedEditorTabSize);
      setEditorWordWrap(config.editorWordWrap || "on");

      setTerminalFontSize(savedTerminalFont);
      setTerminalCursorBlink(config.terminalCursorBlink !== false ? "true" : "false");

      document.documentElement.style.setProperty("--EditorFontSize", `${savedEditorFont}px`);
      document.documentElement.style.setProperty(
        "--EditorLineHeight",
        `${savedEditorLineHeight}px`,
      );
      document.documentElement.style.setProperty("--EditorTabSize", savedEditorTabSize);
      document.documentElement.style.setProperty("--TerminalFontSize", `${savedTerminalFont}px`);
    });
  }, []);

  const handleThemeChange = (newTheme: "light" | "dark" | "system") => {
    setTheme(newTheme);
    const isDark =
      newTheme === "dark" ||
      (newTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    document.documentElement.classList.toggle("dark", isDark);
    UserConfigStore.set({ theme: newTheme });
  };

  const handleAccentThemeChange = (nextAccent: AccentThemeId) => {
    setAccentTheme(nextAccent);
    applyAccentTheme(nextAccent);
    void UserConfigStore.set({ accentTheme: nextAccent });
  };

  const handleLiquidTextureChange = (enabled: boolean) => {
    setLiquidTexture(enabled);
    applyLiquidTexture(enabled);
    void UserConfigStore.set({ liquidTexture: enabled });
  };

  const handleDensityChange = (next: Density) => {
    setDensity(next);
    applyDensity(next);
    void UserConfigStore.set({ density: next });
  };

  const handleBoldTextChange = (enabled: boolean) => {
    setBoldText(enabled);
    if (enabled) {
      document.documentElement.setAttribute("data-bold-text", "true");
    } else {
      document.documentElement.removeAttribute("data-bold-text");
    }
    void UserConfigStore.set({ boldText: enabled });
  };

  const handleInterfaceFontSizeChange = (size: "compact" | "default" | "comfortable" | "large") => {
    setInterfaceFontSize(size);
    if (size !== "default") {
      document.documentElement.setAttribute("data-font-size", size);
    } else {
      document.documentElement.removeAttribute("data-font-size");
    }
    void UserConfigStore.set({ interfaceFontSize: size });
  };

  const resetEditorFontSize = () => {
    setEditorFontSize("14");
    void UserConfigStore.set({ editorFontSize: 14 });
    document.documentElement.style.setProperty("--EditorFontSize", "14px");
    EventBus.emit("settings:editor-changed");
  };

  const resetEditorLineHeight = () => {
    setEditorLineHeight("24");
    void UserConfigStore.set({ editorLineHeight: 24 });
    document.documentElement.style.setProperty("--EditorLineHeight", "24px");
  };

  const resetEditorTabSize = () => {
    setEditorTabSize("2");
    void UserConfigStore.set({ editorTabSize: 2 });
    document.documentElement.style.setProperty("--EditorTabSize", "2");
  };

  const resetEditorWordWrap = () => {
    setEditorWordWrap("on");
    void UserConfigStore.set({ editorWordWrap: "on" });
    EventBus.emit("settings:editor-changed");
  };

  const resetTerminalFontSize = () => {
    setTerminalFontSize("13");
    void UserConfigStore.set({ terminalFontSize: 13 });
    document.documentElement.style.setProperty("--TerminalFontSize", "13px");
    EventBus.emit("settings:terminal-changed");
  };

  const resetTerminalCursorBlink = () => {
    setTerminalCursorBlink("true");
    void UserConfigStore.set({ terminalCursorBlink: true });
    EventBus.emit("settings:terminal-changed");
  };

  const [repoPath, setRepoPath] = useState<string | null>(
    WorkspaceStore.getCached()?.lastOpenedPath || null,
  );
  const [remoteUrl, setRemoteUrl] = useState("");
  const [isSavingGit, setIsSavingGit] = useState(false);
  const [_isGitLoading, setIsGitLoading] = useState(true);

  useEffect(() => {
    if (activeSection !== "sourceControl") return;
    const loadGitConfig = async () => {
      setIsGitLoading(true);
      await WorkspaceStore.init();
      const config = await WorkspaceStore.get();
      if (config.lastOpenedPath) {
        setRepoPath(config.lastOpenedPath);
        try {
          const url = await GitIPC.getRemote(config.lastOpenedPath);
          if (url) {
            try {
              const urlObj = new URL(url);
              urlObj.username = "";
              urlObj.password = "";
              setRemoteUrl(urlObj.toString());
            } catch {
              setRemoteUrl(url);
            }
          }
        } catch (e) {
          console.error(e);
        }
      } else {
        setRepoPath(null);
        showToast(t("settings.toast.noGitWorkspace"), "warning");
      }
      setIsGitLoading(false);
    };
    loadGitConfig();
  }, [activeSection, t]);

  const handleSaveGit = async () => {
    if (!repoPath || !remoteUrl.trim()) {
      showToast(t("settings.toast.enterRemoteUrl"), "error");
      return;
    }
    setIsSavingGit(true);
    try {
      const finalUrl = remoteUrl.trim();
      try {
        const urlObj = new URL(finalUrl);
        if (urlObj.username || urlObj.password) {
          showToast(t("settings.toast.credentialWarning"), "error");
          return;
        }
      } catch {
        // SCP-like SSH remote URLs are valid Git remote URLs and do not expose URL credentials.
      }
      await GitIPC.setRemote(repoPath, finalUrl);
      showToast(t("settings.toast.remoteUpdated"), "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("settings.toast.saveFailed").replace("{message}", message), "error");
    } finally {
      setIsSavingGit(false);
    }
  };

  const navigateTo = (section: SettingsSection) => {
    setActiveSection(section);
    setSettingsQuery("");
  };

  const renderGeneral = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.general")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.generalDescription")}
        </p>
      </div>

      <GlassContainer layer="elevated" className="overflow-hidden rounded-2xl">
        <div
          data-setting-id="theme"
          className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.theme")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.themeDescription")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <fieldset className="grid w-full grid-cols-3 gap-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--material-panel)] p-1.5 shadow-[inset_0_1px_1px_var(--material-inset)] backdrop-blur-[var(--glass-blur-base)] sm:w-auto">
              <legend className="sr-only">{t("settings.theme")}</legend>
              {(["system", "light", "dark"] as const).map((mode) => (
                <button
                  type="button"
                  aria-pressed={theme === mode}
                  key={mode}
                  onClick={() => handleThemeChange(mode)}
                  className={`flex min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 sm:min-w-[104px] ${
                    theme === mode
                      ? "border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)] backdrop-blur-[var(--glass-blur-elevated)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
                  }`}
                >
                  {mode === "system" && (
                    <>
                      <Icons.Monitor size={16} /> {t("settings.themeSystem")}
                    </>
                  )}
                  {mode === "light" && (
                    <>
                      <Icons.Sun size={16} /> {t("settings.themeLight")}
                    </>
                  )}
                  {mode === "dark" && (
                    <>
                      <Icons.Moon size={16} /> {t("settings.themeDark")}
                    </>
                  )}
                </button>
              ))}
            </fieldset>
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => handleThemeChange("system")}
            />
          </div>
        </div>

        <div
          data-setting-id="density"
          className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.density")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.densityDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={density}
              onChange={(value) => handleDensityChange(value as Density)}
              className="w-[140px]"
              options={[
                { value: "default", label: t("settings.densityAuto") },
                { value: "compact", label: t("settings.densityCompact") },
                { value: "regular", label: t("settings.densityRegular") },
                { value: "comfortable", label: t("settings.densityComfortable") },
              ]}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => handleDensityChange("default")}
            />
          </div>
        </div>

        <div
          data-setting-id="language"
          className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.language")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.languageDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={locale}
              onChange={(value) => setLocale(value as Locale)}
              className="w-[160px]"
              options={[
                { value: "zh-CN", label: t("settings.languageZhCN") },
                { value: "zh-Hant", label: t("settings.languageZhHant") },
                { value: "en", label: t("settings.languageEn") },
              ]}
            />
            <SettingResetButton label={t("settings.reset")} onReset={() => setLocale("zh-CN")} />
          </div>
        </div>
      </GlassContainer>
    </div>
  );

  const renderAppearance = () => (
    <AppearanceSettingsSection
      accentTheme={accentTheme}
      intensity={intensity}
      liquidTexture={liquidTexture}
      boldText={boldText}
      interfaceFontSize={interfaceFontSize}
      onAccentThemeChange={handleAccentThemeChange}
      onIntensityChange={(value) => setIntensity(value)}
      onLiquidTextureChange={handleLiquidTextureChange}
      onBoldTextChange={handleBoldTextChange}
      onInterfaceFontSizeChange={handleInterfaceFontSizeChange}
    />
  );

  const renderEditor = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.editorSection.title")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.editorSection.description")}
        </p>
      </div>

      <GlassContainer layer="elevated" className="rounded-2xl overflow-hidden flex flex-col">
        <div
          data-setting-id="editorFontSize"
          className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.editorSection.fontSize")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.editorSection.fontSizeDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={editorFontSize}
              className="w-[140px]"
              onChange={(val: string) => {
                setEditorFontSize(val);
                UserConfigStore.set({ editorFontSize: parseInt(val, 10) });
                document.documentElement.style.setProperty("--EditorFontSize", `${val}px`);
                EventBus.emit("settings:editor-changed");
              }}
              options={[12, 13, 14, 15, 16, 18, 20].map((size) => ({
                value: size.toString(),
                label: `${size}px`,
              }))}
            />
            <SettingResetButton label={t("settings.reset")} onReset={resetEditorFontSize} />
          </div>
        </div>

        <div
          data-setting-id="editorLineHeight"
          className="flex items-center justify-between border-b border-[var(--border-subtle)] p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.editorSection.lineHeight")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.editorSection.lineHeightDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={editorLineHeight}
              className="w-[140px]"
              onChange={(value) => {
                setEditorLineHeight(value);
                UserConfigStore.set({ editorLineHeight: Number(value) });
                document.documentElement.style.setProperty("--EditorLineHeight", `${value}px`);
              }}
              options={[20, 22, 24, 26, 28, 30].map((value) => ({
                value: String(value),
                label: `${value}px`,
              }))}
            />
            <SettingResetButton label={t("settings.reset")} onReset={resetEditorLineHeight} />
          </div>
        </div>

        <div
          data-setting-id="editorTabSize"
          className="flex items-center justify-between border-b border-[var(--border-subtle)] p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.editorSection.tabWidth")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.editorSection.tabWidthDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={editorTabSize}
              className="w-[140px]"
              onChange={(value) => {
                setEditorTabSize(value);
                UserConfigStore.set({ editorTabSize: Number(value) });
                document.documentElement.style.setProperty("--EditorTabSize", value);
              }}
              options={[2, 4, 8].map((value) => ({
                value: String(value),
                label: `${value} spaces`,
              }))}
            />
            <SettingResetButton label={t("settings.reset")} onReset={resetEditorTabSize} />
          </div>
        </div>

        <div
          data-setting-id="editorWordWrap"
          className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.editorSection.wordWrap")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.editorSection.wordWrapDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={editorWordWrap === "on"}
              onCheckedChange={(checked) => {
                const val = checked ? "on" : "off";
                setEditorWordWrap(val);
                UserConfigStore.set({ editorWordWrap: val });
                EventBus.emit("settings:editor-changed");
              }}
            />
            <SettingResetButton label={t("settings.reset")} onReset={resetEditorWordWrap} />
          </div>
        </div>

        <div data-setting-id="editorMinimap" className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.editorSection.minimap")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.editorSection.minimapDescription")}
            </span>
          </div>
          <span className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-[12px] text-[var(--color-text-muted)]">
            {t("settings.editorSection.unavailable")}
          </span>
        </div>
      </GlassContainer>
    </div>
  );

  const renderTerminalRun = () => (
    <div className="flex flex-col gap-7 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.terminalRun")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.terminalRunDescription")}
        </p>
      </div>

      <GlassContainer layer="elevated" className="rounded-2xl overflow-hidden flex flex-col">
        <div
          data-setting-id="terminalFontSize"
          className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.terminalSection.fontSize")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.terminalSection.fontSizeDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={terminalFontSize}
              className="w-[140px]"
              onChange={(val: string) => {
                setTerminalFontSize(val);
                UserConfigStore.set({ terminalFontSize: parseInt(val, 10) });
                document.documentElement.style.setProperty("--TerminalFontSize", `${val}px`);
                EventBus.emit("settings:terminal-changed");
              }}
              options={[12, 13, 14, 15, 16, 18, 20].map((size) => ({
                value: size.toString(),
                label: `${size}px`,
              }))}
            />
            <SettingResetButton label={t("settings.reset")} onReset={resetTerminalFontSize} />
          </div>
        </div>

        <div
          data-setting-id="terminalCursorBlink"
          className="flex items-center justify-between p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.terminalSection.cursorBlink")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.terminalSection.cursorBlinkDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={terminalCursorBlink === "true"}
              onCheckedChange={(checked) => {
                const val = checked ? "true" : "false";
                setTerminalCursorBlink(val);
                UserConfigStore.set({ terminalCursorBlink: checked });
                EventBus.emit("settings:terminal-changed");
              }}
            />
            <SettingResetButton label={t("settings.reset")} onReset={resetTerminalCursorBlink} />
          </div>
        </div>
      </GlassContainer>

      <DebugSettings />
    </div>
  );

  const renderSourceControl = () => (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.sourceControl")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.sourceControlDescription")}
        </p>
      </div>

      {!repoPath ? (
        <GlassContainer
          layer="elevated"
          className="mt-2 flex max-w-md flex-col items-center justify-center gap-4 rounded-2xl p-6 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
            <Icons.Git size={22} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-[14px] font-bold text-[var(--color-text-highlight)]">
              {t("settings.sourceControlSection.noRepo")}
            </h4>
            <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              {t("settings.sourceControlSection.noRepoDescription")}
            </p>
          </div>
        </GlassContainer>
      ) : (
        <GlassContainer
          layer="elevated"
          className="mt-2 flex max-w-3xl flex-col overflow-hidden rounded-2xl"
        >
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
              <Icons.Git size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                {t("settings.sourceControlSection.currentRepo")}
              </div>
              <div className="truncate text-[11px] text-[var(--color-text-muted)]">{repoPath}</div>
            </div>
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--material-interactive-hover)] px-2.5 py-1 text-[10px] font-medium text-[var(--color-text-muted)]">
              {t("settings.sourceControlSection.localConfig")}
            </span>
          </div>

          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                    {t("settings.sourceControlSection.remoteUrl")}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {t("settings.sourceControlSection.remoteUrlDescription")}
                  </span>
                </div>
                <Icons.Github size={18} className="shrink-0 text-[var(--color-text-muted)]" />
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--material-panel)] p-1 focus-within:border-[var(--color-text-muted)]/25 focus-within:ring-2 focus-within:ring-[var(--color-text-muted)]/20">
                <Input
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  fullWidth
                  surface="embedded"
                  inputSize="lg"
                />
              </div>
            </div>

            <div className="flex items-start gap-3 px-3 py-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
              <Icons.Info size={16} className="mt-0.5 shrink-0" />
              <span>{t("settings.sourceControlSection.credentialsNote")}</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-5 py-4">
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.sourceControlSection.localOnly")}
            </span>
            <Button
              variant="glass"
              onClick={handleSaveGit}
              disabled={isSavingGit || !remoteUrl.trim()}
            >
              <Icons.Save size={14} />
              {isSavingGit
                ? t("settings.sourceControlSection.applying")
                : t("settings.sourceControlSection.apply")}
            </Button>
          </div>
        </GlassContainer>
      )}
    </div>
  );

  const renderSystem = () => (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <StorageSettingsSection />

      <GlassContainer layer="elevated" className="overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] p-5">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.openPerformance")}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("settings.openPerformanceDescription")}
            </p>
          </div>
          <Button
            variant="glass"
            className="h-9 shrink-0 px-4 text-[12px]"
            onClick={() => void CommandRegistry.execute("workbench.action.openPerformance")}
          >
            <Icons.Play size={14} />
            {t("settings.openPerformance")}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.openAbout")}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("settings.openAboutDescription")}
            </p>
          </div>
          <Button
            variant="glass"
            className="h-9 shrink-0 px-4 text-[12px]"
            onClick={() => void CommandRegistry.execute("workbench.action.openAbout")}
          >
            <Icons.Info size={14} />
            {t("settings.openAbout")}
          </Button>
        </div>
      </GlassContainer>
    </div>
  );

  const renderAdvanced = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.advanced")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.advancedDescription")}
        </p>
      </div>

      <GlassContainer layer="elevated" className="rounded-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.checkUpdate")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.checkUpdateDescription")}
            </span>
          </div>
          <Button
            variant="secondary"
            className="h-8 text-[12px] px-3.5"
            disabled={isCheckingUpdate}
            onClick={() => {
              setIsCheckingUpdate(true);
              void UpdaterService.checkForUpdates()
                .then((result) => {
                  if (result.status === "up-to-date") {
                    showToast(t("settings.toast.upToDate"), "success");
                  } else if (result.status === "error") {
                    showToast(
                      t("settings.toast.checkUpdateFailed").replace("{message}", result.error),
                      "error",
                    );
                  }
                })
                .finally(() => setIsCheckingUpdate(false));
            }}
          >
            {isCheckingUpdate ? t("settings.checkingUpdate") : t("settings.checkUpdate")}
          </Button>
        </div>
        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.resetApp")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.resetAppDescription")}
            </span>
          </div>
          <Button
            variant="danger"
            className="h-8 text-[12px] px-3.5"
            onClick={() => {
              desktopFileSystem
                .remove("user-config.json", { baseDir: BaseDirectory.AppLocalData })
                .catch(() => {});
              desktopFileSystem
                .remove("workspace.json", { baseDir: BaseDirectory.AppLocalData })
                .catch(() => {});
              localStorage.clear();
              showToast(t("settings.toast.cacheCleared"));
            }}
          >
            {t("settings.resetAppAction")}
          </Button>
        </div>
        <div className="flex items-start gap-3 border-t border-[var(--border-subtle)] px-5 py-4 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
          <Icons.Settings size={16} className="mt-0.5 shrink-0" />
          <span>{t("settings.advancedEmpty")}</span>
        </div>
      </GlassContainer>
    </div>
  );

  const query = settingsQuery.trim();
  const searchResults = useMemo(() => (query ? searchSettings(query, t) : []), [query, t]);

  const renderSearchResults = () => (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.searchResults")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("fliuno.resultsCount").replace("{count}", String(searchResults.length))}
        </p>
      </div>

      {searchResults.length === 0 ? (
        <GlassContainer
          layer="elevated"
          className="flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-14 text-center"
        >
          <Icons.Search size={26} className="text-[var(--color-text-muted)]" />
          <p className="text-[13px] text-[var(--color-text-muted)]">{t("settings.noResults")}</p>
        </GlassContainer>
      ) : (
        <div className="flex flex-col gap-2">
          {searchResults.map((setting) => (
            <button
              key={setting.id}
              type="button"
              onClick={() => {
                setActiveSection(CATEGORY_TO_SECTION[setting.category]);
                setSettingsQuery("");
                setRevealTarget({ settingId: setting.id, nonce: Date.now() });
              }}
              className="flex w-full items-center gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)] p-4 text-left transition-[background-color,border-color] hover:border-[var(--border-overlay)] hover:bg-[var(--material-interactive-hover)]"
            >
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--material-interactive-active)] text-[var(--color-accent)]">
                <Icons.Settings size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-[var(--color-text-highlight)]">
                  {t(setting.titleKey)}
                </div>
                {setting.descriptionKey && (
                  <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                    {t(setting.descriptionKey)}
                  </p>
                )}
                <span className="mt-1.5 inline-flex rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                  {t(SETTING_CATEGORY_KEYS[setting.category])}
                </span>
              </div>
              <Icons.ChevronRight size={16} className="shrink-0 text-[var(--color-text-muted)]" />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderSection = () => {
    switch (activeSection) {
      case "general":
        return renderGeneral();
      case "appearance":
        return renderAppearance();
      case "editor":
        return renderEditor();
      case "codeIntelligence":
        return <LanguageServiceSettings />;
      case "terminalRun":
        return renderTerminalRun();
      case "sourceControl":
        return renderSourceControl();
      case "accountCloud":
        return <AccountSettings />;
      case "system":
        return renderSystem();
      case "advanced":
        return renderAdvanced();
    }
  };

  const sidebarMenu = (
    <div className="flex w-full flex-col gap-1.5 pl-1 pr-3">
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--material-panel)] px-3 py-2 shadow-[inset_0_1px_1px_var(--material-inset)]">
        <Icons.Search size={15} className="shrink-0 text-[var(--color-text-muted)]" />
        <input
          data-aurona-input="embedded"
          value={settingsQuery}
          onChange={(event) => setSettingsQuery(event.target.value)}
          placeholder={t("settings.searchPlaceholder")}
          aria-label={t("settings.searchPlaceholder")}
          className="w-full bg-transparent text-[13px] text-[var(--color-text-highlight)] outline-none placeholder:text-[var(--color-text-muted)]"
        />
        {settingsQuery && (
          <button
            type="button"
            aria-label={t("common.clear")}
            onClick={() => setSettingsQuery("")}
            className="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-highlight)]"
          >
            <Icons.Close size={14} />
          </button>
        )}
      </div>

      {SECTION_META.map(({ id, labelKey, Icon }) => (
        <SettingsNavItem
          key={id}
          label={t(labelKey)}
          icon={<Icon size={16} />}
          active={activeSection === id}
          onClick={() => navigateTo(id)}
        />
      ))}
    </div>
  );

  const getTitle = () => {
    if (query) return t("settings.title");
    const meta = SECTION_META.find((item) => item.id === activeSection);
    return meta ? t(meta.labelKey) : t("settings.title");
  };

  return (
    <InternalPageLayout title={getTitle()} sidebar={sidebarMenu} maxWidth="max-w-4xl">
      {query ? renderSearchResults() : renderSection()}
    </InternalPageLayout>
  );
}
