import { type ComponentType, useCallback, useEffect, useState } from "react";
import { BaseDirectory, desktopFileSystem } from "../../Foundation/Desktop";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { StorageIPC } from "../../Foundation/IPC/StorageCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { clearWorkspaceLocalState } from "./storageOwnership";

interface StorageBreakdown {
  appDataBytes: number;
  logBytes: number;
  configBytes: number;
  workspaceBytes: number;
  recoveryBytes: number;
  performanceBytes: number;
  cacheBytes: number;
  errlogBytes: number;
  extensionBytes: number;
  extensionStorageBytes: number;
  toolchainBytes: number;
  otherAppDataBytes: number;
}

type ClearTarget =
  | "config"
  | "workspace"
  | "recovery"
  | "cache"
  | "logs"
  | "errlogs"
  | "extensionStorage"
  | "toolchains"
  | "performance"
  | "other";

type StorageGroup = "core" | "extensions" | "toolchains" | "cache" | "logs" | "other";

const ROW_GROUP: Record<ClearTarget, StorageGroup> = {
  config: "core",
  workspace: "core",
  recovery: "core",
  performance: "core",
  extensionStorage: "extensions",
  toolchains: "toolchains",
  cache: "cache",
  logs: "logs",
  errlogs: "logs",
  other: "other",
};

/** 组色值同时用于图例圆点、占比环与分类卡描边，统一取语义令牌。 */
const GROUP_META: Array<{
  id: StorageGroup;
  color: string;
  nameKey: I18nKey;
  icon: ComponentType<{ size?: number }>;
}> = [
  {
    id: "core",
    color: "var(--StatusSuccess)",
    nameKey: "settings.storage.groupCore",
    icon: Icons.Settings,
  },
  {
    id: "extensions",
    color: "var(--VizTeal)",
    nameKey: "settings.storage.groupExtensions",
    icon: Icons.Extensions,
  },
  {
    id: "toolchains",
    color: "var(--VizIndigo)",
    nameKey: "settings.storage.groupToolchains" as I18nKey,
    icon: Icons.Terminal,
  },
  {
    id: "cache",
    color: "var(--VizSky)",
    nameKey: "settings.storage.groupCache",
    icon: Icons.Eraser,
  },
  {
    id: "logs",
    color: "var(--VizFuchsia)",
    nameKey: "settings.storage.groupLogs",
    icon: Icons.FileText,
  },
  {
    id: "other",
    color: "var(--color-accent)",
    nameKey: "settings.storage.groupOther",
    icon: Icons.Files,
  },
];

/** 可安全清理聚合（总览高亮卡 + 一键清理的范围） */
const SAFE_CLEAR_TARGETS: ClearTarget[] = ["cache", "logs", "errlogs"];

const EMPTY_BREAKDOWN: StorageBreakdown = {
  appDataBytes: 0,
  logBytes: 0,
  configBytes: 0,
  workspaceBytes: 0,
  recoveryBytes: 0,
  performanceBytes: 0,
  cacheBytes: 0,
  errlogBytes: 0,
  extensionBytes: 0,
  extensionStorageBytes: 0,
  toolchainBytes: 0,
  otherAppDataBytes: 0,
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function StorageSettingsSection() {
  const { t } = useLocale();
  const [sizes, setSizes] = useState<StorageBreakdown>(EMPTY_BREAKDOWN);
  const [clearing, setClearing] = useState<ClearTarget | "safe" | null>(null);
  const [exitCleanup, setExitCleanup] = useState(true);

  useEffect(() => {
    void UserConfigStore.get().then((config) => {
      setExitCleanup(config.cleanup?.clearCacheOnExit !== false);
    });
  }, []);

  const handleExitCleanupToggle = async (enabled: boolean) => {
    setExitCleanup(enabled);
    try {
      await StorageIPC.setExitCleanupEnabled(enabled);
      const config = await UserConfigStore.get();
      await UserConfigStore.set({
        cleanup: { ...config.cleanup, clearCacheOnExit: enabled },
      });
    } catch (error) {
      setExitCleanup(!enabled);
      showToast(String(error), "error");
    }
  };

  const loadSizes = useCallback(async () => {
    try {
      setSizes(await StorageIPC.getBreakdown<StorageBreakdown>());
    } catch {
      setSizes(EMPTY_BREAKDOWN);
    }
  }, []);

  useEffect(() => {
    void loadSizes();
  }, [loadSizes]);

  const clear = async (target: ClearTarget) => {
    setClearing(target);
    try {
      switch (target) {
        case "config":
          await desktopFileSystem.remove("user-config.json", {
            baseDir: BaseDirectory.AppLocalData,
          });
          UserConfigStore.resetCache();
          showToast(t("settings.storage.toasts.configCleared"), "success");
          break;
        case "workspace":
          await desktopFileSystem.remove("workspace.json", {
            baseDir: BaseDirectory.AppLocalData,
          });
          WorkspaceStore.resetCache();
          clearWorkspaceLocalState();
          showToast(t("settings.storage.toasts.workspaceCleared"), "success");
          break;
        case "recovery":
          await StorageIPC.clearEditorRecovery();
          showToast(t("settings.storage.toasts.recoveryCleared"), "success");
          break;
        case "extensionStorage":
          await StorageIPC.clearExtensionStorage();
          showToast(t("settings.storage.toasts.extensionStorageCleared"), "success");
          break;
        case "toolchains":
          await StorageIPC.clearToolchains();
          showToast(t("settings.storage.toasts.toolchainsCleared"), "success");
          break;
        case "cache":
          await StorageIPC.clearWebviewCache();
          showToast(t("settings.storage.toasts.cacheCleared"), "success");
          break;
        case "logs":
          await StorageIPC.clearAppLogs();
          showToast(t("settings.storage.toasts.logsCleared"), "success");
          break;
        case "errlogs":
          await StorageIPC.clearErrLogs();
          showToast(t("settings.storage.toasts.errlogsCleared"), "success");
          break;
        case "performance":
          await StorageIPC.clearPerformanceBaseline();
          showToast(t("settings.storage.toasts.performanceCleared"), "success");
          break;
        case "other":
          await StorageIPC.clearOtherAppData();
          showToast(t("settings.storage.toasts.otherCleared"), "success");
          break;
      }
      await loadSizes();
    } catch (error) {
      showToast(
        t("settings.storage.toasts.clearFailed").replace("{message}", String(error)),
        "error",
      );
      await loadSizes().catch(() => undefined);
    } finally {
      setClearing(null);
    }
  };

  const clearSafeAll = async () => {
    setClearing("safe");
    try {
      await StorageIPC.clearWebviewCache();
      await StorageIPC.clearAppLogs();
      await StorageIPC.clearErrLogs();
      showToast(t("settings.storage.toasts.safeCleared"), "success");
      await loadSizes();
    } catch (error) {
      showToast(
        t("settings.storage.toasts.clearFailed").replace("{message}", String(error)),
        "error",
      );
      await loadSizes().catch(() => undefined);
    } finally {
      setClearing(null);
    }
  };

  const rows: {
    id: ClearTarget;
    name: string;
    file: string;
    description: string;
    raw: number;
  }[] = [
    {
      id: "cache",
      name: t("settings.storage.rows.cache.name"),
      file: "EBWebView/",
      description: t("settings.storage.rows.cache.description"),
      raw: sizes.cacheBytes,
    },
    {
      id: "toolchains",
      name: t("settings.storage.rows.toolchains.name"),
      file: "toolchains/",
      description: t("settings.storage.rows.toolchains.description"),
      raw: sizes.toolchainBytes,
    },
    {
      id: "extensionStorage",
      name: t("settings.storage.rows.extensionStorage.name"),
      file: "extension-storage/",
      description: t("settings.storage.rows.extensionStorage.description"),
      raw: sizes.extensionStorageBytes,
    },
    {
      id: "logs",
      name: t("settings.storage.rows.logs.name"),
      file: "logs/",
      description: t("settings.storage.rows.logs.description"),
      raw: sizes.logBytes,
    },
    {
      id: "errlogs",
      name: t("settings.storage.rows.errlogs.name"),
      file: "errlogs/",
      description: t("settings.storage.rows.errlogs.description"),
      raw: sizes.errlogBytes,
    },
    {
      id: "recovery",
      name: t("settings.storage.rows.recovery.name"),
      file: "editor-recovery/",
      description: t("settings.storage.rows.recovery.description"),
      raw: sizes.recoveryBytes,
    },
    {
      id: "performance",
      name: t("settings.storage.rows.performance.name"),
      file: "performance-baseline.json",
      description: t("settings.storage.rows.performance.description"),
      raw: sizes.performanceBytes,
    },
    {
      id: "workspace",
      name: t("settings.storage.rows.workspace.name"),
      file: "workspace.json",
      description: t("settings.storage.rows.workspace.description"),
      raw: sizes.workspaceBytes,
    },
    {
      id: "config",
      name: t("settings.storage.rows.config.name"),
      file: "user-config.json",
      description: t("settings.storage.rows.config.description"),
      raw: sizes.configBytes,
    },
    {
      id: "other",
      name: t("settings.storage.rows.other.name"),
      file: "AppLocalData",
      description: t("settings.storage.rows.other.description"),
      raw: sizes.otherAppDataBytes,
    },
  ];

  const totalRawSize = sizes.appDataBytes;
  const totalFormatted = formatBytes(totalRawSize);
  const totalForBar = totalRawSize === 0 ? 1 : totalRawSize;
  const safeBytes = SAFE_CLEAR_TARGETS.reduce(
    (sum, target) => sum + (rows.find((row) => row.id === target)?.raw ?? 0),
    0,
  );

  const groupBytes = (group: StorageGroup) =>
    rows.filter((row) => ROW_GROUP[row.id] === group).reduce((sum, row) => sum + row.raw, 0);

  // 纯 CSS conic-gradient 占比环：按组顺序累积扇区
  const donutStops: string[] = [];
  let donutAcc = 0;
  for (const group of GROUP_META) {
    const start = donutAcc;
    donutAcc = Math.min(100, donutAcc + (groupBytes(group.id) / totalForBar) * 100);
    donutStops.push(`${group.color} ${start.toFixed(2)}% ${donutAcc.toFixed(2)}%`);
  }
  const donutBackground =
    totalRawSize === 0 ? "var(--material-surface)" : `conic-gradient(${donutStops.join(", ")})`;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
            {t("settings.storage.title")}
          </h3>
          <Button
            variant="glass"
            className="flex h-8 items-center gap-1.5 px-3 text-[12px]"
            onClick={async () => {
              try {
                await StorageIPC.openAppDataFolder();
              } catch (err) {
                showToast(String(err), "error");
              }
            }}
          >
            <Icons.FolderOpen size={14} />
            <span>{t("settings.storage.openAppDataDir")}</span>
          </Button>
        </div>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.storage.description")}
        </p>
      </div>

      {/* 总览卡：单卡整合 总占用 / 可安全清理 / 占比环 + 图例 */}
      <GlassContainer layer="raised" className="overflow-hidden p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="select-none text-[11px] font-medium text-[var(--color-text-muted)]">
              {t("settings.storage.localDataUsed")}
            </span>
            <span className="select-none text-[28px] leading-none font-extrabold tracking-tight text-[var(--color-text-highlight)]">
              {totalFormatted}
            </span>
            <span className="select-none text-[10.5px] text-[var(--color-text-muted)]">
              {t("settings.storage.appDataDir")}
            </span>
          </div>

          <div className="flex shrink-0 flex-col gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--color-accent)_30%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] p-4 sm:w-[240px]">
            <span className="select-none text-[11px] font-medium text-[var(--color-accent)]">
              {t("settings.storage.safeToClean")}
            </span>
            <span className="select-none text-[22px] leading-none font-extrabold tracking-tight text-[var(--color-text-highlight)]">
              {formatBytes(safeBytes)}
            </span>
            <span className="text-[10px] leading-4 text-[var(--color-text-muted)]">
              {t("settings.storage.rows.cache.name")} · {t("settings.storage.rows.logs.name")} ·{" "}
              {t("settings.storage.rows.errlogs.name")}
            </span>
            <Button
              variant="primary"
              className="h-8 px-3 text-[12px]"
              disabled={clearing !== null || safeBytes === 0}
              onClick={() => void clearSafeAll()}
            >
              {clearing === "safe"
                ? t("settings.storage.clearing")
                : t("settings.storage.cleanAll")}
            </Button>
          </div>

          <div className="relative mx-auto size-24 shrink-0 sm:ml-0">
            <div
              className="size-full rounded-full"
              style={{
                background: donutBackground,
                maskImage: "radial-gradient(closest-side, transparent 64%, black 65%)",
                WebkitMaskImage: "radial-gradient(closest-side, transparent 64%, black 65%)",
              }}
            />
            <span className="absolute inset-0 grid place-items-center text-[12px] font-bold text-[var(--color-text-highlight)]">
              {GROUP_META.length}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--border-subtle)] pt-3 select-none">
          {GROUP_META.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: group.color }} />
              <span>{t(group.nameKey)}</span>
            </div>
          ))}
          <p className="w-full pt-1 text-[10.5px] leading-4 text-[var(--color-text-muted)]/80">
            {t("settings.storage.note")}
          </p>
        </div>
      </GlassContainer>

      {/* 分类卡：核心数据 / 扩展 / 工具链 / 缓存 / 日志 / 其他（一行最多两个） */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GROUP_META.map((group) => {
          const GroupIcon = group.icon;
          const groupRows = rows.filter((row) => ROW_GROUP[row.id] === group.id);
          const cleanable = group.id === "cache" || group.id === "logs";
          return (
            <GlassContainer
              key={group.id}
              layer="base"
              className={`flex flex-col overflow-hidden p-4 ${
                cleanable
                  ? "border-[color-mix(in_srgb,var(--StatusError)_22%,var(--border-subtle))]"
                  : ""
              }`}
            >
              <div className="flex items-center gap-2.5 pb-2">
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-lg"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${group.color} 12%, transparent)`,
                    color: group.color,
                  }}
                >
                  <GroupIcon size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-text-highlight)] select-none">
                  {t(group.nameKey)}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--color-text-muted)] select-none">
                  {formatBytes(groupBytes(group.id))}
                </span>
              </div>
              <div className="flex flex-col">
                {groupRows.map((row, index) => {
                  return (
                    <Tooltip key={row.id} content={row.description} placement="top">
                      <div
                        className={`flex items-center gap-2 py-2 ${
                          index < groupRows.length - 1
                            ? "border-b border-[var(--border-subtle)]"
                            : ""
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[12px] font-medium text-[var(--color-text-highlight)]">
                              {row.name}
                            </span>
                            <span className="hidden truncate font-mono text-[9.5px] text-[var(--color-text-muted)] sm:block">
                              {row.file}
                            </span>
                          </span>
                          <span className="truncate text-[10px] text-[var(--color-text-muted)]">
                            {formatBytes(row.raw)}
                          </span>
                        </div>
                        <Button
                          variant={
                            row.id === "config" || row.id === "workspace" || row.id === "recovery"
                              ? "danger"
                              : "glass"
                          }
                          className="h-7 shrink-0 px-2.5 text-[11px]"
                          disabled={clearing !== null || row.raw === 0}
                          onClick={() => void clear(row.id)}
                        >
                          {clearing === row.id
                            ? t("settings.storage.clearing")
                            : t("settings.storage.clear")}
                        </Button>
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </GlassContainer>
          );
        })}
      </div>

      {/* 退出清理开关（保留） */}
      <GlassContainer layer="base" className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="select-none text-[13px] font-medium text-[var(--color-text-highlight)]">
            {t("settings.storage.exitCleanupTitle")}
          </span>
          <span className="text-[11.5px] leading-4 text-[var(--color-text-muted)]">
            {t("settings.storage.exitCleanupDescription")}
          </span>
        </div>
        <Switch
          checked={exitCleanup}
          onCheckedChange={handleExitCleanupToggle}
          aria-label={t("settings.storage.exitCleanupTitle")}
        />
      </GlassContainer>

      <div className="flex items-start gap-3 px-3 py-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
        <Icons.Info size={16} className="mt-0.5 shrink-0" />
        <span>{t("settings.storage.footerNote")}</span>
      </div>
    </div>
  );
}
