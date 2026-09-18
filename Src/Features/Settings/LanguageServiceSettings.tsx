import { type ReactNode, useEffect, useMemo, useState } from "react";
import { DiagnosticsService } from "../../Core/DiagnosticsService";
import { type LanguageServerInfo, LspClient } from "../../Core/Language/LspClient";
import { EventBus } from "../../Foundation/EventBus";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { LanguageFeaturePreferences } from "../../Foundation/Types/Config";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

const DEFAULTS: Required<LanguageFeaturePreferences> = {
  hoverEnabled: true,
  hoverDelayMs: 600,
  automaticCompletion: true,
};

function statusLabel(t: (key: I18nKey) => string, state: LanguageServerInfo | undefined): string {
  if (!state) return t("settings.codeIntelligence.notStarted");
  const labels: Partial<Record<LanguageServerInfo["status"], I18nKey>> = {
    stopped: "settings.codeIntelligence.stopped",
    starting: "settings.codeIntelligence.starting",
    initializing: "settings.codeIntelligence.initializing",
    running: "settings.codeIntelligence.running",
    restarting: "settings.codeIntelligence.restarting",
    failed: "settings.codeIntelligence.failed",
    stopping: "settings.codeIntelligence.stopping",
  };
  return labels[state.status] ? t(labels[state.status] as I18nKey) : state.status;
}

export function LanguageServiceSettings() {
  const { t } = useLocale();
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [, setRevision] = useState(0);
  const client = useMemo(() => LspClient.getInstance(), []);
  const diagnostics = DiagnosticsService.getAll();
  const states = client.getStates();
  const diagnosticsCount = diagnostics.reduce(
    (total, document) => total + document.diagnostics.length,
    0,
  );

  useEffect(() => {
    void UserConfigStore.get().then((config) =>
      setPreferences({ ...DEFAULTS, ...config.languageFeatures }),
    );
    const unsubscribeLsp = client.subscribe(() => setRevision((value) => value + 1));
    const unsubscribeDiagnostics = DiagnosticsService.subscribe(() =>
      setRevision((value) => value + 1),
    );
    return () => {
      unsubscribeLsp();
      unsubscribeDiagnostics();
    };
  }, [client]);

  const updatePreferences = async (patch: Partial<LanguageFeaturePreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    await UserConfigStore.set({ languageFeatures: next });
    EventBus.emit("settings:language-changed");
  };

  const openToolchains = () => {
    useWorkbenchStore.getState().setActiveSidebar("extensions");
    EventBus.emit("marketplace:navigate", { mode: "toolchains" });
  };

  const openOutput = () => useWorkbenchStore.getState().setActiveBottomPanel("output");

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <section className="space-y-2">
        <SectionHeading
          title={t("settings.codeIntelligence.experienceTitle")}
          description={t("settings.codeIntelligence.experienceDescription")}
        />
        <GlassContainer layer="raised" className="overflow-hidden">
          <SettingRow
            settingId="hoverEnabled"
            title={t("settings.codeIntelligence.hover")}
            description={t("settings.codeIntelligence.hoverDescription")}
            onReset={() => void updatePreferences({ hoverEnabled: true })}
            control={
              <Switch
                checked={preferences.hoverEnabled}
                onCheckedChange={(checked) => void updatePreferences({ hoverEnabled: checked })}
              />
            }
          />
          <SettingRow
            settingId="hoverDelayMs"
            title={t("settings.codeIntelligence.hoverDelay")}
            description={t("settings.codeIntelligence.hoverDelayDescription")}
            onReset={() => void updatePreferences({ hoverDelayMs: 600 })}
            control={
              <Select
                ariaLabel={t("settings.codeIntelligence.hoverDelay")}
                value={String(preferences.hoverDelayMs)}
                onChange={(value) => void updatePreferences({ hoverDelayMs: Number(value) })}
                options={[
                  { value: "150", label: "150 ms" },
                  { value: "350", label: "350 ms" },
                  { value: "600", label: "600 ms" },
                  { value: "1000", label: "1000 ms" },
                ]}
              />
            }
          />
          <SettingRow
            settingId="automaticCompletion"
            title={t("settings.codeIntelligence.completion")}
            description={t("settings.codeIntelligence.completionDescription")}
            onReset={() => void updatePreferences({ automaticCompletion: true })}
            control={
              <Switch
                checked={preferences.automaticCompletion}
                onCheckedChange={(checked) =>
                  void updatePreferences({ automaticCompletion: checked })
                }
              />
            }
          />
        </GlassContainer>
      </section>

      <section className="space-y-2">
        <SectionHeading
          title={t("settings.codeIntelligence.serversTitle")}
          description={t("settings.codeIntelligence.serversDescription")}
        />
        <GlassContainer layer="raised" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-4 pl-5 pr-4">
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
              <Icons.Stack size={15} />
              <span>
                {t("settings.codeIntelligence.serversSummary")
                  .replace("{servers}", String(states.length))
                  .replace("{diagnostics}", String(diagnosticsCount))}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={openOutput}>
                <Icons.Terminal size={13} />
                {t("settings.codeIntelligence.openOutput")}
              </Button>
              <Button size="sm" variant="primary" onClick={openToolchains}>
                <Icons.Extensions size={13} />
                {t("settings.codeIntelligence.goToMarketplace")}
              </Button>
            </div>
          </div>
          {states.length === 0 ? (
            <div className="p-5 text-[12px] text-[var(--color-text-muted)]">
              {t("settings.codeIntelligence.notStarted")}
            </div>
          ) : (
            states.map((state) => (
              <ServerStatusRow key={state.language} state={state} label={statusLabel(t, state)} />
            ))
          )}
        </GlassContainer>
      </section>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
        {description}
      </p>
    </div>
  );
}

function SettingRow({
  settingId,
  title,
  description,
  control,
  onReset,
}: {
  settingId: string;
  title: string;
  description: string;
  control: ReactNode;
  onReset: () => void;
}) {
  return (
    <div
      data-setting-id={settingId}
      className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5 first:border-t-0"
    >
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-[var(--color-text-highlight)]">{title}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SettingResetButton label={title} onReset={onReset} />
        {control}
      </div>
    </div>
  );
}

function ServerStatusRow({ state, label }: { state: LanguageServerInfo; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] p-5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[12.5px] font-medium text-[var(--color-text-highlight)]">
          {state.language}
        </span>
        <span className="truncate text-[11px] text-[var(--color-text-muted)]">{state.command}</span>
      </div>
      <span
        className={
          state.status === "running"
            ? "text-[11px] text-[var(--StatusSuccess)]"
            : state.status === "failed"
              ? "text-[11px] text-[var(--StatusError)]"
              : "text-[11px] text-[var(--color-text-muted)]"
        }
      >
        {label}
      </span>
    </div>
  );
}
