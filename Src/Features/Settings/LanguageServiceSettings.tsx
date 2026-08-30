import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type LanguageServerInfo, LspClient } from "../../Core/Language/LspClient";
import { OutputService } from "../../Core/OutputService";
import { EventBus } from "../../Foundation/EventBus";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import {
  LanguageServerIPC,
  type ToolchainsOverview,
} from "../../Foundation/IPC/LanguageServerCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { LanguageFeaturePreferences } from "../../Foundation/Types/Config";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Select } from "../../UI/Components/Select";
import { SettingResetButton } from "../../UI/Components/SettingResetButton";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { MarketplaceService } from "../Extensions/Marketplace/MarketplaceService";

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function getLanguageVisual(id: string, name: string, languages: string[] = []) {
  const combined = `${id} ${name} ${languages.join(" ")}`.toLowerCase();
  if (combined.includes("python") || combined.includes("pyright")) {
    return {
      icon: <Icons.FilePy size={20} />,
      bgClass: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
    };
  }
  if (combined.includes("rust") || combined.includes("cargo")) {
    return {
      icon: <Icons.FileRust size={20} />,
      bgClass: "bg-orange-500/10 text-orange-400 border border-orange-500/20",
    };
  }
  if (
    combined.includes("clangd") ||
    combined.includes("cpp") ||
    combined.includes("c++") ||
    combined.includes("c/c++") ||
    combined.includes("cuda")
  ) {
    return {
      icon: <Icons.FileCpp size={20} />,
      bgClass: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
    };
  }
  if (combined.includes("gopls") || combined.includes("golang") || combined.includes("go")) {
    return {
      icon: <Icons.FileGo size={20} />,
      bgClass: "bg-sky-500/10 text-sky-400 border border-sky-500/20",
    };
  }
  if (combined.includes("vue")) {
    return {
      icon: <Icons.FileVue size={20} />,
      bgClass: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    };
  }
  if (
    combined.includes("html") ||
    combined.includes("css") ||
    combined.includes("json") ||
    combined.includes("web")
  ) {
    return {
      icon: <Icons.FileHtml size={20} />,
      bgClass: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
    };
  }
  return {
    icon: <Icons.FileTs size={20} />,
    bgClass: "bg-blue-600/10 text-blue-400 border border-blue-600/20",
  };
}

export function LanguageServiceSettings() {
  const { t } = useLocale();
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [, setRevision] = useState(0);
  const [busyLanguage, setBusyLanguage] = useState<string | null>(null);
  const [toolchainsOverview, setToolchainsOverview] = useState<ToolchainsOverview | null>(null);
  const [loadingToolchains, setLoadingToolchains] = useState(false);
  const [isDownloadingRuntime, setIsDownloadingRuntime] = useState(false);
  const [runtimeProgress, setRuntimeProgress] = useState(0);
  const [runtimeStageText, setRuntimeStageText] = useState("");
  const client = LspClient.getInstance();

  const loadToolchains = useCallback(async (showNotice = false) => {
    try {
      setLoadingToolchains(true);
      const overview = await LanguageServerIPC.listToolchains();
      setToolchainsOverview(overview);
      setRevision((v) => v + 1);
      if (showNotice) {
        showToast("已刷新语言服务与运行时状态", "info");
      }
    } catch {
      // 优雅降级
    } finally {
      setLoadingToolchains(false);
    }
  }, []);

  useEffect(() => {
    void UserConfigStore.get().then((config) => {
      setPreferences({ ...DEFAULTS, ...config.languageFeatures });
    });
    void loadToolchains(false);
    return client.subscribe(() => setRevision((value) => value + 1));
  }, [client, loadToolchains]);

  const updatePreferences = async (patch: Partial<LanguageFeaturePreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    await UserConfigStore.set({ languageFeatures: next });
    EventBus.emit("settings:language-changed");
  };

  const handleDownloadNodeRuntime = async () => {
    if (isDownloadingRuntime) return;
    try {
      setIsDownloadingRuntime(true);
      setRuntimeProgress(5);
      setRuntimeStageText("正在请求下载官方 Node.js 运行时...");
      await MarketplaceService.ensureSharedRuntime("node", (progress, stage) => {
        setRuntimeProgress(progress);
        setRuntimeStageText(
          stage === "downloading"
            ? `正在下载 (${Math.round(progress)}%)...`
            : "正在解压并部署环境...",
        );
      });
      await loadToolchains();
      showToast("官方公共 Node.js 运行时已下载并就绪！", "info");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "下载运行时失败，请检查网络";
      showToast(msg, "warning");
    } finally {
      setIsDownloadingRuntime(false);
      setRuntimeProgress(0);
      setRuntimeStageText("");
    }
  };

  const runAction = async (language: string, action: "start" | "stop" | "restart") => {
    setBusyLanguage(language);
    try {
      if (action === "start") await client.startServer(language);
      else if (action === "stop") await client.stopServer(language);
      else await client.restartServer(language);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("NO_LSP_INSTALLED")) {
        showToast(`未安装 ${language} 语言服务，请前往扩展市场下载安装对应 LSP`, "warning");
      } else {
        showToast(`操作失败: ${msg}`, "warning");
      }
    } finally {
      setBusyLanguage(null);
    }
  };

  // 只有本地实际安装了的 LSP 服务才展示在列表中
  const installedServers = toolchainsOverview?.servers || [];
  const nodeRuntimeInstalled =
    toolchainsOverview?.runtimes?.some((r) => r.runtimeType === "node") ?? false;
  const nodeRuntimeInfo = toolchainsOverview?.runtimes?.find((r) => r.runtimeType === "node");

  return (
    <div className="flex w-full max-w-3xl flex-col gap-7">
      {/* 1. 编辑器语言体验 */}
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

      {/* 2. 官方公共基础运行时 (由设置中心统一托管，不与扩展市场混杂) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
              {t("settings.codeIntelligence.runtimesSectionTitle")}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              {t("settings.codeIntelligence.runtimesSectionDescription")}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-3 rounded-lg text-[12px] gap-1.5 hover:bg-[var(--material-interactive-hover)] border border-[var(--border-subtle)]"
            onClick={() => void loadToolchains(true)}
            disabled={loadingToolchains}
          >
            <Icons.Refresh
              size={14}
              className={loadingToolchains ? "animate-spin text-blue-400" : ""}
            />
            <span>{loadingToolchains ? "正在检查..." : "刷新状态"}</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {/* Node.js 共享运行时卡片 */}
          <GlassContainer
            layer="elevated"
            className="rounded-2xl p-4 flex flex-col justify-between gap-3 border border-[var(--border-subtle)]"
          >
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
                <Icons.Terminal size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[13px] text-[var(--color-text-highlight)]">
                    Node.js Runtime
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    {t("extensions.badgeRuntime")}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                  提供 TypeScript、Pyright 等基于 JS/TS 的语言服务器共享底层运行环境
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)] text-[11px]">
              {nodeRuntimeInstalled ? (
                <>
                  <span className="flex items-center gap-1 text-[var(--StatusSuccess)] font-medium">
                    <Icons.Check size={13} stroke={2.5} />
                    {t("settings.codeIntelligence.runtimeReady")} (v
                    {nodeRuntimeInfo?.version || "22.22.0"})
                  </span>
                  <span className="text-[var(--color-text-muted)] font-mono">
                    {formatBytes(nodeRuntimeInfo?.diskSizeBytes || 0)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-amber-400 font-medium">
                    {t("settings.codeIntelligence.runtimeMissing")}
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    className="h-7 px-3 text-[11px] rounded-lg"
                    onClick={handleDownloadNodeRuntime}
                    disabled={isDownloadingRuntime}
                  >
                    <Icons.Download size={12} className="mr-1.5 inline" />
                    {isDownloadingRuntime ? "正在下载..." : "立即下载基础运行时"}
                  </Button>
                </>
              )}
            </div>

            {/* 运行时下载实时长条进度条 */}
            {isDownloadingRuntime && (
              <div className="w-full pt-2 border-t border-[var(--border-subtle)] animate-in fade-in duration-200">
                <div className="flex items-center justify-between text-[10.5px] text-amber-400 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Icons.Refresh size={11} className="animate-spin text-amber-400" />
                    {runtimeStageText || "正在下载..."}
                  </span>
                  <span className="font-mono font-bold">{Math.round(runtimeProgress)}%</span>
                </div>
                <div className="h-1.5 w-full bg-[var(--border-subtle)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-150"
                    style={{ width: `${Math.max(3, runtimeProgress)}%` }}
                  />
                </div>
              </div>
            )}
          </GlassContainer>
        </div>
      </section>

      {/* 3. 已安装语言服务状态（仅在下载安装后显示） */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
              {t("settings.codeIntelligence.serversTitle")}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              {t("settings.codeIntelligence.serversDescription")}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 px-3 text-[12px] rounded-lg border border-[var(--border-subtle)]"
            onClick={() => useWorkbenchStore.getState().setActiveSidebar("extensions")}
          >
            <Icons.Extensions size={14} className="mr-1.5 inline text-blue-400" />
            {t("settings.codeIntelligence.goToMarketplace")}
          </Button>
        </div>

        {installedServers.length === 0 ? (
          <GlassContainer
            layer="elevated"
            className="rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-2 border border-[var(--border-subtle)]"
          >
            <Icons.FileCode size={26} className="text-[var(--color-text-muted)] opacity-60" />
            <span className="text-[12.5px] font-semibold text-[var(--color-text-highlight)]">
              暂未安装任何语言服务
            </span>
            <p className="text-[11px] text-[var(--color-text-muted)] max-w-md leading-relaxed">
              Aurona Code 已取消内置笨重 LSP。您可在扩展市场中搜索 Python、TypeScript、Rust
              等语言服务，一键按需下载安装。
            </p>
            <Button
              size="sm"
              variant="primary"
              className="mt-2 h-8 px-4 text-[12px] rounded-lg shadow-sm"
              onClick={() => useWorkbenchStore.getState().setActiveSidebar("extensions")}
            >
              <Icons.Extensions size={14} className="mr-1.5 inline" />
              前往扩展市场安装语言服务
            </Button>
          </GlassContainer>
        ) : (
          <div className="space-y-3">
            {installedServers.map((srv) => {
              const language = srv.languages[0] || srv.name.toLowerCase();
              const state = client.getState(language);
              const running = state?.status === "running";
              const busy = busyLanguage === language;
              const visual = getLanguageVisual(srv.id, srv.name, srv.languages);

              return (
                <GlassContainer key={srv.id} layer="elevated" className="rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${visual.bgClass}`}
                    >
                      {visual.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[13px] text-[var(--color-text-highlight)]">
                          {srv.name}
                        </span>
                        <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 font-mono text-[9px] text-[var(--color-text-muted)]">
                          v{srv.version} · {t("settings.codeIntelligence.marketplaceService")}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                            running
                              ? "bg-[var(--StatusSuccess)]/10 text-[var(--StatusSuccess)]"
                              : state?.status === "failed"
                                ? "bg-[var(--StatusError)]/10 text-[var(--StatusError)]"
                                : "bg-[var(--material-interactive-hover)] text-[var(--color-text-muted)]"
                          }`}
                        >
                          {statusLabel(t, state)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                        支持语言: {srv.languages.join(", ")} · 运行时: {srv.runtimeType} · 体积:{" "}
                        {formatBytes(srv.diskSizeBytes)}
                      </p>
                      {state?.lastError && (
                        <p className="mt-2 line-clamp-2 font-mono text-[10px] text-[var(--StatusError)]">
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
                              `Open language server log requested for ${srv.name}`,
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
        )}
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
