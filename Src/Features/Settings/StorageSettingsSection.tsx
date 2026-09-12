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

const GROUP_META: Array<{ id: StorageGroup; bar: string; dot: string; nameKey: I18nKey }> = [
  {
    id: "core",
    bar: "bg-[var(--StatusSuccess)]/85",
    dot: "bg-[var(--StatusSuccess)]",
    nameKey: "settings.storage.groupCore",
  },
  {
    id: "extensions",
    bar: "bg-emerald-500/85",
    dot: "bg-emerald-500",
    nameKey: "settings.storage.groupExtensions",
  },
  {
    id: "toolchains",
    bar: "bg-indigo-500/85",
    dot: "bg-indigo-500",
    nameKey: "settings.storage.groupToolchains" as I18nKey,
  },
  {
    id: "cache",
    bar: "bg-sky-500/85",
    dot: "bg-sky-500",
    nameKey: "settings.storage.groupCache",
  },
  {
    id: "logs",
    bar: "bg-fuchsia-500/85",
    dot: "bg-fuchsia-500",
    nameKey: "settings.storage.groupLogs",
  },
  {
    id: "other",
    bar: "bg-[var(--color-accent)]",
    dot: "bg-[var(--color-accent)]",
    nameKey: "settings.storage.groupOther",
  },
];

const ROW_ICON: Record<ClearTarget, ComponentType<{ size?: number }>> = {
  config: Icons.Settings,
  workspace: Icons.Folder,
  recovery: Icons.History,
  extensionStorage: Icons.Database,
  toolchains: Icons.Terminal,
  cache: Icons.Eraser,
  logs: Icons.FileText,
  errlogs: Icons.AlertTriangle,
  performance: Icons.Refresh,
  other: Icons.Files,
};

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
  const [clearing, setClearing] = useState<ClearTarget | null>(null);
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

  const rows: {
    id: ClearTarget;
    name: string;
    file: string;
    description: string;
    raw: number;
    danger?: boolean;
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
      danger: true,
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
      danger: true,
    },
    {
      id: "config",
      name: t("settings.storage.rows.config.name"),
      file: "user-config.json",
      description: t("settings.storage.rows.config.description"),
      raw: sizes.configBytes,
      danger: true,
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

  const groupMeta = (target: ClearTarget) =>
    GROUP_META.find((group) => group.id === ROW_GROUP[target]);

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

      {/* 总览：分段占比条 + 分组图例 */}
      <GlassContainer layer="raised" className="flex flex-col gap-4 p-6">
        <div className="flex items-end justify-between">
          <span className="select-none text-[20px] font-extrabold tracking-tight text-[var(--color-text-highlight)]">
            {totalFormatted}{" "}
            <span className="font-sans text-[12px] font-normal text-[var(--color-text-muted)]">
              {t("settings.storage.localDataUsed")}
            </span>
          </span>
          <span className="select-none text-[12px] font-medium text-[var(--color-text-muted)]">
            {t("settings.storage.appDataDir")}
          </span>
        </div>

        <div className="flex h-3.5 w-full select-none overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--material-panel)] p-px shadow-[inset_0_1px_2px_var(--material-inset)]">
          {totalRawSize === 0 && (
            <div
              className="h-full rounded-full bg-[var(--material-surface)]"
              style={{ width: "100%" }}
            />
          )}
          {rows.map((row) =>
            row.raw > 0 ? (
              <div
                key={row.id}
                className={`h-full ${groupMeta(row.id)?.bar ?? ""} transition-opacity hover:opacity-80`}
                style={{ width: `${(row.raw / totalForBar) * 100}%` }}
              />
            ) : null,
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 select-none">
          {GROUP_META.map((group) => {
            const bytes = rows
              .filter((row) => ROW_GROUP[row.id] === group.id)
              .reduce((sum, row) => sum + row.raw, 0);
            return (
              <div
                key={group.id}
                className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]"
              >
                <div className={`h-2 w-2 rounded-full ${group.dot}`} />
                <span>
                  {t(group.nameKey)} ({formatBytes(bytes)})
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] leading-5 text-[var(--color-text-muted)]">
          {t("settings.storage.note")}
        </p>
      </GlassContainer>

      {/* 明细与清理 */}
      <GlassContainer layer="raised" className="flex flex-col overflow-hidden">
        {/* 退出清理开关 */}
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] p-5">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="select-none text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("settings.storage.exitCleanupTitle")}
            </span>
            <span className="text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("settings.storage.exitCleanupDescription")}
            </span>
          </div>
          <Switch
            checked={exitCleanup}
            onCheckedChange={handleExitCleanupToggle}
            aria-label={t("settings.storage.exitCleanupTitle")}
          />
        </div>

        {rows.map((row, index) => {
          const RowIcon = ROW_ICON[row.id];
          return (
            <div
              key={row.id}
              className={`flex items-center gap-4 p-5 ${
                index < rows.length - 1 ? "border-b border-[var(--border-subtle)]" : ""
              }`}
            >
              <div className="relative h-9 w-9 shrink-0 rounded-lg bg-[var(--material-interactive-hover)]">
                <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
                  <RowIcon size={16} />
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full shadow-[0_0_0_2px_var(--material-interactive-hover)] ${groupMeta(row.id)?.dot ?? ""}`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2 text-[14px] font-medium text-[var(--color-text-highlight)] select-none">
                  {row.name}
                  <span className="rounded-lg bg-[var(--material-surface)] px-2 py-0.5 font-mono text-[11px] font-normal text-[var(--color-text-muted)]">
                    {row.file}
                  </span>
                </span>
                <span className="text-[12px] leading-5 text-[var(--color-text-muted)]">
                  {row.description}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span className="select-none font-mono text-[13px] text-[var(--color-text-highlight)]">
                  {formatBytes(row.raw)}
                </span>
                <Button
                  variant={row.danger ? "danger" : "glass"}
                  className="h-8 px-3.5 text-[12px]"
                  disabled={clearing !== null || row.raw === 0}
                  onClick={() => void clear(row.id)}
                >
                  {clearing === row.id
                    ? t("settings.storage.clearing")
                    : t("settings.storage.clear")}
                </Button>
              </div>
            </div>
          );
        })}
      </GlassContainer>

      <div className="flex items-start gap-3 px-3 py-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
        <Icons.Info size={16} className="mt-0.5 shrink-0" />
        <span>{t("settings.storage.footerNote")}</span>
      </div>
    </div>
  );
}
