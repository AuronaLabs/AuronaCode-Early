import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BuiltInToolRegistry } from "../../Core/BuiltInToolRegistry";
import { type LanguageServerInfo, LspClient } from "../../Core/Language/LspClient";
import { OutputService } from "../../Core/OutputService";
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

const statusLabel = (t: (key: I18nKey) => string, state: LanguageServerInfo | undefined) => {
  if (!state) return t("settings.codeIntelligence.notStarted");
  return (
    {
      stopped: t("settings.codeIntelligence.stopped"),
      starting: t("settings.codeIntelligence.starting"),
      initializing: t("settings.codeIntelligence.initializing"),
      running: t("settings.codeIntelligence.running"),
      restarting: t("settings.codeIntelligence.restarting"),
      failed: t("settings.codeIntelligence.failed"),
      stopping: t("settings.codeIntelligence.stopping"),
    }[state.status] ?? state.status
  );
};

export function LanguageServiceSettings() {
  const { t } = useLocale();
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [revision, setRevision] = useState(0);
  const [busyLanguage, setBusyLanguage] = useState<string | null>(null);
  const client = LspClient.getInstance();

  useEffect(() => {
    void UserConfigStore.get().then((config) => {
      setPreferences({ ...DEFAULTS, ...config.languageFeatures });
    });
    return client.subscribe(() => setRevision((value) => value + 1));
  }, [client]);

  const servers = useMemo(() => BuiltInToolRegistry.getByKind("language-server"), []);
  void revision;

  const updatePreferences = async (patch: Partial<LanguageFeaturePreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    await UserConfigStore.set({ languageFeatures: next });
    EventBus.emit("settings:language-changed");
  };

  const runAction = async (language: string, action: "start" | "stop" | "restart") => {
    setBusyLanguage(language);
    try {
      if (action === "start") await client.startServer(language);
      else if (action === "stop") await client.stopServer(language);
      else await client.restartServer(language);
    } finally {
      setBusyLanguage(null);
    }
  };

  return (
    <div className="flex w-full max-w-3xl flex-col gap-7">
      <section className="space-y-3">
        <div>
          <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
            {t("settings.codeIntelligence.experienceTitle")}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            {t("settings.codeIntelligence.experienceDescription")}
          </p>
        </div>
        <GlassContainer
          layer="elevated"
          className="divide-y divide-[var(--border-subtle)] rounded-2xl"
        >
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

      <section className="space-y-3">
        <div>
          <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
            {t("settings.codeIntelligence.serversTitle")}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            {t("settings.codeIntelligence.serversDescription")}
          </p>
        </div>
        <div className="space-y-3">
          {servers.map((tool) => {
            const language = tool.languages[0];
            const state = client.getState(language);
            const running = state?.status === "running";
            const busy = busyLanguage === language;
            return (
              <GlassContainer key={tool.id} layer="elevated" className="rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
                    {language === "python" ? (
                      <Icons.FilePy size={20} />
                    ) : (
                      <Icons.FileTs size={20} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[13px] text-[var(--color-text-highlight)]">
                        {tool.label}
                      </span>
                      <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 font-mono text-[9px] text-[var(--color-text-muted)]">
                        v{tool.version} · {t("settings.codeIntelligence.builtin")}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                          running
                            ? "bg-emerald-500/10 text-emerald-500"
                            : state?.status === "failed"
                              ? "bg-red-500/10 text-red-500"
                              : "bg-[var(--material-interactive-hover)] text-[var(--color-text-muted)]"
                        }`}
                      >
                        {statusLabel(t, state)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                      {t(tool.descriptionKey)}
                    </p>
                    {state?.lastError && (
                      <p className="mt-2 line-clamp-2 font-mono text-[10px] text-red-500">
                        {state.lastError}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!running ? (
                        <Button
                          size="sm"
                          variant="glass"
                          disabled={busy}
                          onClick={() => void runAction(language, "start")}
                        >
                          <Icons.Play size={13} />
                          {t("settings.codeIntelligence.start")}
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="glass"
                            disabled={busy}
                            onClick={() => void runAction(language, "restart")}
                          >
                            <Icons.Refresh size={13} />
                            {t("settings.codeIntelligence.restart")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void runAction(language, "stop")}
                          >
                            {t("settings.codeIntelligence.stop")}
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          OutputService.append(
                            "language-server",
                            `Open language server log requested for ${tool.label}`,
                            "info",
                          );
                          useWorkbenchStore.getState().setActiveBottomPanel("output");
                        }}
                      >
                        {t("settings.codeIntelligence.openOutput")}
                      </Button>
                    </div>
                  </div>
                </div>
              </GlassContainer>
            );
          })}
        </div>
      </section>
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
  settingId?: string;
  title: string;
  description: string;
  control: ReactNode;
  onReset?: () => void;
}) {
  const { t } = useLocale();
  return (
    <div data-setting-id={settingId} className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-[var(--color-text-highlight)]">{title}</div>
        <div className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          {description}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {control}
        {onReset && <SettingResetButton label={t("settings.reset")} onReset={onReset} />}
      </div>
    </div>
  );
}
