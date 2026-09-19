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
import { cn } from "../../Shared/Utils/cn";
import { Button } from "../../UI/Components/Button";
import { EmptyState } from "../../UI/Components/EmptyState";
import { Input } from "../../UI/Components/Input";
import { SettingsNavItem } from "../../UI/Components/SettingsNavItem";
import { GlassContainer, useGlassStore } from "../../UI/Core/GlassManager";
import { glassVariants } from "../../UI/Core/GlassManager/variants";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { AccountSettings } from "./AccountSettings";
import { AdvancedSettingsSection } from "./AdvancedSettingsSection";
import { AiSettingsSection } from "./AiSettingsSection";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { DebugSettings } from "./DebugSettings";
import { EditorSettingsSection } from "./EditorSettingsSection";
import { ExtensionsSettingsSection } from "./ExtensionsSettingsSection";
import { type Density, GeneralSettingsSection } from "./GeneralSettingsSection";
import { LanguageServiceSettings } from "./LanguageServiceSettings";
import { NetworkSettingsSection, type ProxyMode } from "./NetworkSettingsSection";
import { SourceControlSettingsSection } from "./SourceControlSettingsSection";
import { StorageSettingsSection } from "./StorageSettingsSection";

export type SettingsSection =
  | "general"
  | "appearance"
  | "editor"
  | "codeIntelligence"
  | "terminalRun"
  | "sourceControl"
  | "network"
  | "ai"
  | "accountCloud"
  | "extensions"
  | "system"
  | "advanced";

const CATEGORY_TO_SECTION: Record<SettingCategory, SettingsSection> = {
  general: "general",
  appearance: "appearance",
  editor: "editor",
  codeIntelligence: "codeIntelligence",
  terminalRun: "terminalRun",
  sourceControl: "sourceControl",
  network: "network",
  accountCloud: "accountCloud",
  extensions: "extensions",
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
  { id: "network", labelKey: "settings.categories.network", Icon: Icons.World },
  { id: "ai", labelKey: "settings.categories.ai", Icon: Icons.Sparkles },
  { id: "accountCloud", labelKey: "settings.categories.accountCloud", Icon: Icons.User },
  { id: "extensions", labelKey: "settings.categories.extensions", Icon: Icons.Extensions },
  { id: "system", labelKey: "settings.categories.system", Icon: Icons.Database },
  { id: "advanced", labelKey: "settings.categories.advanced", Icon: Icons.Settings },
];

export function getSettingsSectionTitleKey(section: SettingsSection): I18nKey {
  return (
    SECTION_META.find((item) => item.id === section)?.labelKey ?? "settings.categories.general"
  );
}

export function sectionForSettingCategory(category: SettingCategory): SettingsSection {
  return CATEGORY_TO_SECTION[category];
}

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

  /** 玻璃强度松手提交：同步写入 UserConfig 外观段（拖动中的实时预览只走玻璃 store） */
  const handleGlassIntensityCommit = (value: number) => {
    setIntensity(value);
    void UserConfigStore.get().then((config) =>
      UserConfigStore.set({ appearance: { ...config.appearance, glassIntensity: value } }),
    );
  };

  useEffect(() => {
    const unsub = EventBus.on("settings:nav", (section: SettingsSection) => {
      setActiveSection(section);
    });
    const unsubReveal = EventBus.on("settings:reveal", ({ category, settingId }) => {
      setActiveSection(sectionForSettingCategory(category));
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

  const [muteNonCriticalToasts, setMuteNonCriticalToasts] = useState(false);
  const [toastDuration, setToastDuration] = useState(4000);
  const [fliunoOpenMode, setFliunoOpenMode] = useState<"sidebar" | "editorTab">("sidebar");
  const [proxyMode, setProxyMode] = useState<ProxyMode>("system");
  const [proxyUrl, setProxyUrl] = useState("");

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

      // 玻璃强度：UserConfig 外观段为准（旧三档字符串只在玻璃 store 持久化里，已由 migrate 迁移）
      const savedGlassIntensity = config.appearance?.glassIntensity;
      if (typeof savedGlassIntensity === "number") {
        setIntensity(savedGlassIntensity);
      }

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

      setMuteNonCriticalToasts(config.muteNonCriticalToasts ?? false);
      setToastDuration(config.toastDuration ?? 4000);
      setFliunoOpenMode(config.fliuno?.openMode ?? "sidebar");
      setProxyMode(config.network?.proxyMode ?? "system");
      setProxyUrl(config.network?.proxyUrl ?? "");

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
  }, [setIntensity]);

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

  const handleFliunoOpenModeChange = (next: "sidebar" | "editorTab") => {
    setFliunoOpenMode(next);
    void UserConfigStore.get().then((config) =>
      UserConfigStore.set({ fliuno: { ...config.fliuno, openMode: next } }),
    );
  };

  const handleProxyModeChange = (next: ProxyMode) => {
    setProxyMode(next);
    void UserConfigStore.get().then((config) =>
      UserConfigStore.set({ network: { ...config.network, proxyMode: next } }),
    );
  };

  const handleProxyUrlChange = (next: string) => {
    setProxyUrl(next);
    void UserConfigStore.get().then((config) =>
      UserConfigStore.set({ network: { ...config.network, proxyUrl: next } }),
    );
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

  const handleMuteNonCriticalChange = (muted: boolean) => {
    setMuteNonCriticalToasts(muted);
    void UserConfigStore.set({ muteNonCriticalToasts: muted });
  };

  const handleToastDurationChange = (duration: number) => {
    setToastDuration(duration);
    void UserConfigStore.set({ toastDuration: duration });
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

  const activeSectionTitle = useMemo(
    () => t(getSettingsSectionTitleKey(activeSection)),
    [activeSection, t],
  );

  const renderContent = () => {
    if (settingsQuery.trim()) {
      return (
        <div className="flex flex-col gap-4 w-full max-w-3xl">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {searchResults.length} {t("settings.searchResultsLabel")}
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
            <EmptyState
              icon={<Icons.Search size={27} stroke={1.45} />}
              title={t("settings.noSearchResults")}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {searchResults.map((item) => {
                const targetSection = sectionForSettingCategory(item.category);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      navigateTo(targetSection);
                      setRevealTarget({ settingId: item.id, nonce: Date.now() });
                    }}
                    className={cn(
                      glassVariants({ layer: "raised", interactive: true }),
                      "flex flex-col gap-1 p-4 text-left",
                    )}
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
            muteNonCriticalToasts={muteNonCriticalToasts}
            toastDuration={toastDuration}
            fliunoOpenMode={fliunoOpenMode}
            onThemeChange={handleThemeChange}
            onDensityChange={handleDensityChange}
            onMuteNonCriticalChange={handleMuteNonCriticalChange}
            onToastDurationChange={handleToastDurationChange}
            onFliunoOpenModeChange={handleFliunoOpenModeChange}
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
            onIntensityCommit={handleGlassIntensityCommit}
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
      case "network":
        return (
          <NetworkSettingsSection
            proxyMode={proxyMode}
            proxyUrl={proxyUrl}
            onProxyModeChange={handleProxyModeChange}
            onProxyUrlChange={handleProxyUrlChange}
          />
        );
      case "ai":
        return <AiSettingsSection />;
      case "accountCloud":
        return <AccountSettings />;
      case "extensions":
        return <ExtensionsSettingsSection />;
      case "system":
        return (
          <div className="flex w-full max-w-3xl flex-col gap-6">
            <StorageSettingsSection />
            <GlassContainer layer="raised" className="overflow-hidden">
              <div className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0">
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
              <div className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0">
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
      <Input
        icon={<Icons.Search size={14} />}
        inputSize="lg"
        fullWidth
        value={settingsQuery}
        onChange={(e) => setSettingsQuery(e.target.value)}
        placeholder={t("settings.searchPlaceholder")}
      />
      <div className="flex flex-col gap-1 w-full">{navItems}</div>
    </div>
  );

  return (
    <InternalPageLayout title={activeSectionTitle} sidebar={sidebarContent}>
      {renderContent()}
    </InternalPageLayout>
  );
}
