import { type ReactNode, useEffect, useState } from "react";
import { BuiltInToolRegistry } from "../../Core/BuiltInToolRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { DebugPreferences } from "../../Foundation/Types/Config";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";

const defaults: Required<DebugPreferences> = {
  openSidebarOnStart: true,
  consoleMode: "integrated",
  stopOnEntry: false,
  adapterLogLevel: "info",
  pythonPath: "python",
  nodePath: "node",
};

export function DebugSettings() {
  const { t } = useLocale();
  const [preferences, setPreferences] = useState<Required<DebugPreferences>>(defaults);
  useEffect(() => {
    void UserConfigStore.get().then((config) => setPreferences({ ...defaults, ...config.debug }));
  }, []);

  const update = (patch: Partial<DebugPreferences>) => {
    const next: Required<DebugPreferences> = { ...preferences, ...patch };
    setPreferences(next);
    void UserConfigStore.set({ debug: next });
    EventBus.emit("settings:debug-changed", next);
  };

  return (
    <div className="space-y-7">
      <Group
        title={t("settings.debug.experienceTitle")}
        description={t("settings.debug.experienceDescription")}
      >
        <Row
          settingId="openSidebarOnStart"
          label={t("settings.debug.openSidebar")}
          onReset={() => update({ openSidebarOnStart: true })}
        >
          <Switch
            checked={preferences.openSidebarOnStart}
            onCheckedChange={(value) => update({ openSidebarOnStart: value })}
          />
        </Row>
        <Row
          settingId="stopOnEntry"
          label={t("settings.debug.stopOnEntry")}
          onReset={() => update({ stopOnEntry: false })}
        >
          <Switch
            checked={preferences.stopOnEntry}
            onCheckedChange={(value) => update({ stopOnEntry: value })}
          />
        </Row>
        <Row
          settingId="consoleMode"
          label={t("settings.debug.console")}
          onReset={() => update({ consoleMode: "integrated" })}
        >
          <Select
            ariaLabel={t("settings.debug.console")}
            value={preferences.consoleMode}
            options={[
              { value: "integrated", label: t("settings.debug.consoleIntegrated") },
              { value: "terminal", label: t("settings.debug.consoleTerminal") },
              { value: "none", label: t("settings.debug.consoleNone") },
            ]}
            onChange={(value) => update({ consoleMode: value as DebugPreferences["consoleMode"] })}
          />
        </Row>
        <Row
          settingId="adapterLogLevel"
          label={t("settings.debug.adapterLogLevel")}
          onReset={() => update({ adapterLogLevel: "info" })}
        >
          <Select
            ariaLabel={t("settings.debug.adapterLogLevel")}
            value={preferences.adapterLogLevel}
            options={[
              { value: "error", label: t("settings.debug.logError") },
              { value: "info", label: t("settings.debug.logInfo") },
              { value: "debug", label: t("settings.debug.logDebug") },
            ]}
            onChange={(value) =>
              update({ adapterLogLevel: value as DebugPreferences["adapterLogLevel"] })
            }
          />
        </Row>
      </Group>

      <Group
        title={t("settings.debug.runtimesTitle")}
        description={t("settings.debug.runtimesDescription")}
      >
        <Row
          settingId="pythonPath"
          label={t("settings.debug.python")}
          onReset={() => update({ pythonPath: "python" })}
        >
          <Input
            value={preferences.pythonPath}
            onChange={(event) => update({ pythonPath: event.target.value })}
            className="w-64"
          />
        </Row>
        <Row
          settingId="nodePath"
          label={t("settings.debug.node")}
          onReset={() => update({ nodePath: "node" })}
        >
          <Input
            value={preferences.nodePath}
            onChange={(event) => update({ nodePath: event.target.value })}
            className="w-64"
          />
        </Row>
      </Group>

      <Group
        title={t("settings.debug.adaptersTitle")}
        description={t("settings.debug.adaptersDescription")}
      >
        {BuiltInToolRegistry.getByKind("debug-adapter").map((tool) => (
          <div
            key={tool.id}
            className="flex min-h-14 items-center justify-between gap-6 border-b border-[var(--border-subtle)] p-5 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-[var(--color-text-highlight)]">
                {tool.label}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                {t(tool.descriptionKey)}
              </p>
            </div>
            <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
              {tool.version}
            </span>
          </div>
        ))}
      </Group>
    </div>
  );
}

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">{title}</h3>
        <p className="text-[13px] leading-relaxed text-[var(--color-text-muted)]">{description}</p>
      </div>
      <GlassContainer layer="raised" className="mt-1 overflow-hidden">
        {children}
      </GlassContainer>
    </section>
  );
}

function Row({
  settingId,
  label,
  children,
  onReset,
}: {
  settingId?: string;
  label: string;
  children: ReactNode;
  onReset?: () => void;
}) {
  const { t } = useLocale();
  return (
    <div
      data-setting-id={settingId}
      className="flex min-h-14 items-center justify-between gap-6 border-b border-[var(--border-subtle)] p-5 last:border-b-0"
    >
      <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">{label}</span>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        {onReset && <SettingResetButton label={t("settings.reset")} onReset={onReset} />}
      </div>
    </div>
  );
}
