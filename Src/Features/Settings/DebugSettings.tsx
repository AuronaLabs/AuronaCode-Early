import { type ReactNode, useEffect, useState } from "react";
import { BuiltInToolRegistry } from "../../Core/BuiltInToolRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { DebugPreferences } from "../../Foundation/Types/Config";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
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
      <Group title="调试体验" description="控制调试会话的面板、暂停和日志行为。">
        <Row label="启动时打开侧栏">
          <Switch
            checked={preferences.openSidebarOnStart}
            onCheckedChange={(value) => update({ openSidebarOnStart: value })}
          />
        </Row>
        <Row label="入口处暂停">
          <Switch
            checked={preferences.stopOnEntry}
            onCheckedChange={(value) => update({ stopOnEntry: value })}
          />
        </Row>
        <Row label="调试控制台">
          <Select
            ariaLabel="调试控制台"
            value={preferences.consoleMode}
            options={[
              { value: "integrated", label: "集成控制台" },
              { value: "terminal", label: "集成终端" },
              { value: "none", label: "不打开" },
            ]}
            onChange={(value) => update({ consoleMode: value as DebugPreferences["consoleMode"] })}
          />
        </Row>
        <Row label="Adapter 日志级别">
          <Select
            ariaLabel="Adapter 日志级别"
            value={preferences.adapterLogLevel}
            options={[
              { value: "error", label: "仅错误" },
              { value: "info", label: "信息" },
              { value: "debug", label: "调试" },
            ]}
            onChange={(value) =>
              update({ adapterLogLevel: value as DebugPreferences["adapterLogLevel"] })
            }
          />
        </Row>
      </Group>

      <Group title="运行时路径" description="直接启动程序，不经过 Shell，也不会自动下载软件。">
        <Row label="Python">
          <Input
            value={preferences.pythonPath}
            onChange={(event) => update({ pythonPath: event.target.value })}
            className="w-64"
          />
        </Row>
        <Row label="Node.js">
          <Input
            value={preferences.nodePath}
            onChange={(event) => update({ nodePath: event.target.value })}
            className="w-64"
          />
        </Row>
      </Group>

      <Group
        title="内置调试支持"
        description="协议客户端与界面由 Aurona 提供，Python 调试组件会在首次使用时检查并提供安装入口。"
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
                {tool.description}
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
      <GlassContainer layer="elevated" className="mt-1 overflow-hidden rounded-2xl">
        {children}
      </GlassContainer>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 border-b border-[var(--border-subtle)] p-5 last:border-b-0">
      <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">{label}</span>
      {children}
    </div>
  );
}
