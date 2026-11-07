import { useEffect, useState } from "react";
import {
  ConfigurationService,
  CONFIGURATION_DEFAULTS as defaults,
  resolveConfiguration,
} from "../../Core/Configuration";
import { useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { UserConfig } from "../../Foundation/Types/Config";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";

export interface EditorSettingsSectionProps {
  editorFontSize: string;
  editorLineHeight: string;
  editorTabSize: string;
  editorWordWrap: string;
  setEditorFontSize: (val: string) => void;
  setEditorLineHeight: (val: string) => void;
  setEditorTabSize: (val: string) => void;
  setEditorWordWrap: (val: string) => void;
}

export function EditorSettingsSection({
  editorFontSize,
  editorLineHeight,
  editorTabSize,
  editorWordWrap,
  setEditorFontSize,
  setEditorLineHeight,
  setEditorTabSize,
  setEditorWordWrap,
}: EditorSettingsSectionProps) {
  const { t } = useLocale();
  const [editorMinimap, setEditorMinimap] = useState(false);
  const [editorCapsuleEnabled, setEditorCapsuleEnabled] = useState(true);
  const [cursorSmoothCaret, setCursorSmoothCaret] = useState(true);
  const [smoothScrolling, setSmoothScrolling] = useState(true);

  useEffect(() => {
    let active = true;
    const update = (config: UserConfig) => {
      if (!active) return;
      const value = resolveConfiguration(config);
      setEditorMinimap(value.editorMinimap);
      setEditorCapsuleEnabled(value.editorCapsuleEnabled);
      setCursorSmoothCaret(value.editorCursorSmoothCaret);
      setSmoothScrolling(value.editorSmoothScrolling);
    };
    const unsubscribe = UserConfigStore.subscribe(update);
    void UserConfigStore.get()
      .then(update)
      .catch((error) => {
        if (active) showToast(String(error), "error");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const saveEditor = (patch: Partial<UserConfig>, committed: () => void) => {
    void ConfigurationService.save(patch).then((saved) => {
      if (saved) committed();
    });
  };
  const resetEditorFontSize = () =>
    saveEditor({ editorFontSize: defaults.editorFontSize }, () =>
      setEditorFontSize(String(defaults.editorFontSize)),
    );
  const resetEditorLineHeight = () =>
    saveEditor({ editorLineHeight: defaults.editorLineHeight }, () =>
      setEditorLineHeight(String(defaults.editorLineHeight)),
    );
  const resetEditorTabSize = () =>
    saveEditor({ editorTabSize: defaults.editorTabSize }, () =>
      setEditorTabSize(String(defaults.editorTabSize)),
    );
  const resetEditorWordWrap = () =>
    saveEditor({ editorWordWrap: defaults.editorWordWrap }, () =>
      setEditorWordWrap(defaults.editorWordWrap),
    );
  const handleMinimapChange = (value: boolean) =>
    saveEditor({ editorMinimap: value }, () => setEditorMinimap(value));
  const handleCapsuleChange = (value: boolean) =>
    saveEditor({ editorCapsuleEnabled: value }, () => setEditorCapsuleEnabled(value));
  const handleCursorSmoothChange = (value: boolean) =>
    saveEditor({ editorCursorSmoothCaret: value }, () => setCursorSmoothCaret(value));
  const handleSmoothScrollingChange = (value: boolean) =>
    saveEditor({ editorSmoothScrolling: value }, () => setSmoothScrolling(value));

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.editorSection.title")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.editorSection.description")}
        </p>
      </div>

      <GlassContainer layer="raised" className="overflow-hidden flex flex-col">
        <div
          data-setting-id="editorFontSize"
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
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
                saveEditor({ editorFontSize: Number(val) }, () => setEditorFontSize(val));
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
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
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
                saveEditor({ editorLineHeight: Number(value) }, () => setEditorLineHeight(value));
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
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
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
                saveEditor({ editorTabSize: Number(value) }, () => setEditorTabSize(value));
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
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
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
              onChange={(checked) => {
                const val = checked ? "on" : "off";
                saveEditor({ editorWordWrap: val }, () => setEditorWordWrap(val));
              }}
            />
            <SettingResetButton label={t("settings.reset")} onReset={resetEditorWordWrap} />
          </div>
        </div>

        <div
          data-setting-id="editorMinimap"
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.editorSection.minimap")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.editorSection.minimapDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={editorMinimap}
              onCheckedChange={handleMinimapChange}
              aria-label={t("settings.editorSection.minimap")}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => handleMinimapChange(false)}
            />
          </div>
        </div>

        <div
          data-setting-id="editorCapsuleEnabled"
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.editorSection.capsule")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.editorSection.capsuleDescription")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={editorCapsuleEnabled}
              onCheckedChange={handleCapsuleChange}
              aria-label={t("settings.editorSection.capsule")}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => handleCapsuleChange(true)}
            />
          </div>
        </div>

        <div
          data-setting-id="editorSmoothScrolling"
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.definitions.editorSmoothScrolling.title")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.definitions.editorSmoothScrolling.description")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={smoothScrolling}
              onCheckedChange={handleSmoothScrollingChange}
              aria-label={t("settings.definitions.editorSmoothScrolling.title")}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => handleSmoothScrollingChange(true)}
            />
          </div>
        </div>

        <div
          data-setting-id="editorSmoothCaret"
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.featureFlags.editorSmoothCaret.title")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.featureFlags.editorSmoothCaret.desc")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={cursorSmoothCaret}
              onCheckedChange={handleCursorSmoothChange}
              aria-label={t("settings.featureFlags.editorSmoothCaret.title")}
            />
            <SettingResetButton
              label={t("settings.reset")}
              onReset={() => handleCursorSmoothChange(true)}
            />
          </div>
        </div>
      </GlassContainer>
    </div>
  );
}
