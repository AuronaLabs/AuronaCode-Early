import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyAccentTheme, applyLiquidTexture } from "../../App/ThemeAccent";
import {
  SETTING_CATEGORY_KEYS,
  type SettingCategory,
  searchSettings,
} from "../../Core/Settings/SettingRegistry";
import { CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { AccentThemeId } from "../../Foundation/Types/Config";
import { Button } from "../../UI/Components/Button";
import { SettingsNavItem } from "../../UI/Components/SettingsNavItem";
import { GlassContainer, useGlassStore } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { AccountSettings } from "./AccountSettings";
import { AdvancedSettingsSection } from "./AdvancedSettingsSection";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { DebugSettings } from "./DebugSettings";
import { EditorSettingsSection } from "./EditorSettingsSection";
import { type Density, GeneralSettingsSection } from "./GeneralSettingsSection";
import { LanguageServiceSettings } from "./LanguageServiceSettings";
import { SourceControlSettingsSection } from "./SourceControlSettingsSection";
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
  const { t } = useLocale();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [revealTarget, setRevealTarget] = useState<{ settingId: string; nonce: number } | null>(
    null,
  );
  const revealTargetRef = useRef<number | null>(null);
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
      setEditorFontSize(savedEditorFont);
      setEditorLineHeight(savedEditorLineHeight);
      setEditorTabSize(savedEditorTabSize);
      setEditorWordWrap(config.editorWordWrap || "on");

      document.documentElement.style.setProperty("--EditorFontSize", `${savedEditorFont}px`);
      document.documentElement.style.setProperty(
        "--EditorLineHeight",
        `${savedEditorLineHeight}px`,
      );
      document.documentElement.style.setProperty("--EditorTabSize", savedEditorTabSize);
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

  const navigateTo = useCallback((section: SettingsSection) => {
    setActiveSection(section);
    setSettingsQuery("");
  }, []);

  const searchResults = useMemo(() => {
    const q = settingsQuery.trim();
    if (!q) return [];
    return searchSettings(q, (key) => t(key));
  }, [settingsQuery, t]);

  const navItems = useMemo(() => {
    return SECTION_META.map(({ id, labelKey, Icon }) => {
      const categoryMatch = (Object.keys(CATEGORY_TO_SECTION) as SettingCategory[]).find(
        (cat) => CATEGORY_TO_SECTION[cat] === id,
      );
      const badge =
        settingsQuery.trim() && categoryMatch
          ? searchResults.filter((r) => r.category === categoryMatch).length
          : undefined;

      return (
        <SettingsNavItem
          key={id}
          label={t(labelKey)}
          icon={<Icon size={16} />}
          active={activeSection === id}
          badge={badge && badge > 0 ? badge : undefined}
          onClick={() => navigateTo(id)}
        />
      );
    });
  }, [activeSection, navigateTo, searchResults, settingsQuery, t]);

  const renderContent = () => {
    if (settingsQuery.trim()) {
      return (
        <div className="flex flex-col gap-4 w-full max-w-3xl">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {searchResults.length} 个匹配结果
            </h3>
            <Button
              variant="glass"
              className="h-7 text-[12px] px-3"
              onClick={() => setSettingsQuery("")}
            >
              {t("common.clear")}
            </Button>
          </div>

          {searchResults.length === 0 ? (
            <GlassContainer
              layer="elevated"
              className="flex flex-col items-center justify-center p-8 text-center rounded-2xl"
            >
              <Icons.Search size={28} className="text-[var(--color-text-muted)] opacity-60 mb-2" />
              <p className="text-[13px] text-[var(--color-text-muted)]">
                未找到与 "{settingsQuery}" 相关的设置
              </p>
            </GlassContainer>
          ) : (
            <div className="flex flex-col gap-2">
              {searchResults.map((item) => {
                const targetSection = CATEGORY_TO_SECTION[item.category];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveSection(targetSection);
                      setRevealTarget({ settingId: item.id, nonce: Date.now() });
                    }}
                    className="flex flex-col gap-1 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)] hover:bg-[var(--material-interactive-hover)] text-left transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                        {t(item.titleKey as I18nKey)}
                      </span>
                      <span className="text-[11px] text-[var(--color-accent)] font-medium">
                        {t(SETTING_CATEGORY_KEYS[item.category])}
                      </span>
                    </div>
                    {item.descriptionKey && (
                      <span className="text-[12px] text-[var(--color-text-muted)]">
                        {t(item.descriptionKey as I18nKey)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    switch (activeSection) {
      case "general":
        return (
          <GeneralSettingsSection
            theme={theme}
            density={density}
            onThemeChange={handleThemeChange}
            onDensityChange={handleDensityChange}
          />
        );
      case "appearance":
        return (
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
      case "editor":
        return (
          <EditorSettingsSection
            editorFontSize={editorFontSize}
            editorLineHeight={editorLineHeight}
            editorTabSize={editorTabSize}
            editorWordWrap={editorWordWrap}
            setEditorFontSize={setEditorFontSize}
            setEditorLineHeight={setEditorLineHeight}
            setEditorTabSize={setEditorTabSize}
            setEditorWordWrap={setEditorWordWrap}
          />
        );
      case "codeIntelligence":
        return <LanguageServiceSettings />;
      case "terminalRun":
        return <DebugSettings />;
      case "sourceControl":
        return <SourceControlSettingsSection />;
      case "accountCloud":
        return <AccountSettings />;
      case "system":
        return (
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
      case "advanced":
        return <AdvancedSettingsSection />;
      default:
        return null;
    }
  };

  const sidebarContent = (
    <div className="flex flex-col gap-6 w-full">
      <div className="relative w-full">
        <Icons.Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
        />
        <input
          value={settingsQuery}
          onChange={(e) => setSettingsQuery(e.target.value)}
          placeholder={t("settings.searchPlaceholder")}
          className="w-full h-8 pl-8 pr-3 bg-[var(--material-surface)] border border-[var(--border-subtle)] rounded-lg text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      <div className="flex flex-col gap-1 w-full">{navItems}</div>
    </div>
  );

  return (
    <InternalPageLayout title={t("settings.categories.general")} sidebar={sidebarContent}>
      {renderContent()}
    </InternalPageLayout>
  );
}
