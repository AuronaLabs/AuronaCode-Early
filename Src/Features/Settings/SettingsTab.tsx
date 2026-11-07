import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandRegistry } from "../../Core/Commands/CommandRegistry";
import {
  SETTING_CATEGORY_KEYS,
  type SettingCategory,
  searchSettings,
} from "../../Core/Settings/SettingRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import type { SettingsSection } from "../../Foundation/Types/Settings";
import { cn } from "../../Shared/Utils/cn";
import { Button } from "../../UI/Components/Button";
import { EmptyState } from "../../UI/Components/EmptyState";
import { Input } from "../../UI/Components/Input";
import { SettingsNavItem } from "../../UI/Components/SettingsNavItem";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { glassVariants } from "../../UI/Core/GlassManager/variants";
import { useViewActivity } from "../../UI/Core/ViewActivity";
import { useRetainedViewState } from "../../UI/Core/ViewState";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { AccountSettings } from "./AccountSettings";
import { AdvancedSettingsSection } from "./AdvancedSettingsSection";
import { AiSettingsSection } from "./AiSettingsSection";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { DebugSettings } from "./DebugSettings";
import { EditorSettingsSection } from "./EditorSettingsSection";
import { ExtensionsSettingsSection } from "./ExtensionsSettingsSection";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { useWorkbenchPreferences } from "./hooks/useWorkbenchPreferences";
import { LanguageServiceSettings } from "./LanguageServiceSettings";
import { NetworkSettingsSection } from "./NetworkSettingsSection";
import { SecuritySettingsSection } from "./SecuritySettingsSection";
import { SourceControlSettingsSection } from "./SourceControlSettingsSection";
import { StorageSettingsSection } from "./StorageSettingsSection";

export type { SettingsSection } from "../../Foundation/Types/Settings";

const CATEGORY_TO_SECTION: Record<SettingCategory, SettingsSection> = {
  general: "general",
  appearance: "appearance",
  editor: "editor",
  codeIntelligence: "codeIntelligence",
  terminalRun: "terminalRun",
  sourceControl: "sourceControl",
  network: "network",
  security: "security",
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
  { id: "security", labelKey: "settings.categories.security", Icon: Icons.ShieldCheck },
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

export function SettingsTab() {
  const { t } = useLocale();
  const active = useViewActivity();
  const [activeSection, setActiveSection] = useRetainedViewState<SettingsSection>(
    "settings.section",
    "general",
  );
  const [settingsQuery, setSettingsQuery] = useRetainedViewState("settings.query", "");
  const [revealTarget, setRevealTarget] = useState<{ settingId: string; nonce: number } | null>(
    null,
  );
  const revealTargetRef = useRef<number | null>(null);
  const {
    theme,
    accentTheme,
    liquidTexture,
    density,
    boldText,
    interfaceFontSize,
    muteNonCriticalToasts,
    toastDuration,
    fliunoOpenMode,
    proxyMode,
    proxyUrl,
    intensity,
    setIntensity,
    editorFontSize,
    editorLineHeight,
    editorTabSize,
    editorWordWrap,
    setEditorFontSize,
    setEditorLineHeight,
    setEditorTabSize,
    setEditorWordWrap,
    handleThemeChange,
    handleAccentThemeChange,
    handleLiquidTextureChange,
    handleDensityChange,
    handleBoldTextChange,
    handleInterfaceFontSizeChange,
    handleMuteNonCriticalChange,
    handleToastDurationChange,
    handleFliunoOpenModeChange,
    handleProxyModeChange,
    handleProxyUrlChange,
    handleGlassIntensityCommit,
  } = useWorkbenchPreferences();

  useEffect(() => {
    if (!active) return;
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
  }, [active, setActiveSection]);

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

  const navigateTo = useCallback(
    (section: SettingsSection) => {
      setActiveSection(section);
      setSettingsQuery("");
    },
    [setActiveSection, setSettingsQuery],
  );

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
      case "security":
        return <SecuritySettingsSection />;
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
