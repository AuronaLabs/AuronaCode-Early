import { useCallback, useEffect, useState } from "react";
import { BaseDirectory, desktopFileSystem } from "../../Foundation/Desktop";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { StorageIPC } from "../../Foundation/IPC/StorageCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
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
  otherAppDataBytes: number;
}

type ClearTarget =
  | "config"
  | "workspace"
  | "recovery"
  | "cache"
  | "logs"
  | "errlogs"
  | "performance"
  | "other";

type StorageGroup = "core" | "cache" | "logs" | "other";

const ROW_GROUP: Record<ClearTarget, StorageGroup> = {
  config: "core",
  workspace: "core",
  recovery: "core",
  performance: "core",
  cache: "cache",
  logs: "logs",
  errlogs: "logs",
  other: "other",
};

const GROUP_META: Array<{ id: StorageGroup; color: string; nameKey: I18nKey }> = [
  { id: "core", color: "bg-[var(--StatusSuccess)]/85", nameKey: "settings.storage.groupCore" },
  { id: "cache", color: "bg-sky-500/85", nameKey: "settings.storage.groupCache" },
  { id: "logs", color: "bg-fuchsia-500/85", nameKey: "settings.storage.groupLogs" },
  { id: "other", color: "bg-[var(--color-accent)]", nameKey: "settings.storage.groupOther" },
];

const EMPTY_BREAKDOWN: StorageBreakdown = {
  appDataBytes: 0,
  logBytes: 0,
  configBytes: 0,
  workspaceBytes: 0,
  recoveryBytes: 0,
  performanceBytes: 0,
  cacheBytes: 0,
  errlogBytes: 0,
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
      id: "config",
      name: t("settings.storage.rows.config.name"),
      file: "user-config.json",
      description: t("settings.storage.rows.config.description"),
      raw: sizes.configBytes,
      danger: true,
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
      id: "recovery",
      name: t("settings.storage.rows.recovery.name"),
      file: "editor-recovery/",
      description: t("settings.storage.rows.recovery.description"),
      raw: sizes.recoveryBytes,
      danger: true,
    },
    {
      id: "cache",
      name: t("settings.storage.rows.cache.name"),
      file: "EBWebView/",
      description: t("settings.storage.rows.cache.description"),
      raw: sizes.cacheBytes,
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
      id: "performance",
      name: t("settings.storage.rows.performance.name"),
      file: "performance-baseline.json",
      description: t("settings.storage.rows.performance.description"),
      raw: sizes.performanceBytes,
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

  const groupColor = (target: ClearTarget) =>
    GROUP_META.find((group) => group.id === ROW_GROUP[target])?.color ?? "";

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.storage.title")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.storage.description")}
        </p>
      </div>

      <GlassContainer layer="elevated" className="flex flex-col gap-6 rounded-2xl p-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-end justify-between">
            <span className="text-[20px] font-extrabold tracking-tight text-[var(--color-text-highlight)] select-none">
              {totalFormatted}{" "}
              <span className="font-sans text-[12px] font-normal text-[var(--color-text-muted)]">
                {t("settings.storage.localDataUsed")}
              </span>
            </span>
            <span className="text-[12px] font-medium text-[var(--color-text-muted)] select-none">
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
                  className={`h-full ${groupColor(row.id)} transition-opacity hover:opacity-80`}
                  style={{ width: `${(row.raw / totalForBar) * 100}%` }}
                />
              ) : null,
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 select-none">
            {GROUP_META.map((group) => {
              const bytes = rows
                .filter((row) => ROW_GROUP[row.id] === group.id)
                .reduce((sum, row) => sum + row.raw, 0);
              return (
                <div
                  key={group.id}
                  className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]"
                >
                  <div className={`h-2 w-2 rounded-full ${group.color}`} />
                  <span>
                    {t(group.nameKey)} ({formatBytes(bytes)})
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[var(--color-text-muted)]">
            {t("settings.storage.note")}
          </p>
        </div>
      </GlassContainer>

      <div className="mt-2 flex flex-col gap-4">
        <h4 className="px-1 text-[13px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.storage.detailsTitle")}
        </h4>

        <GlassContainer layer="elevated" className="flex flex-col overflow-hidden rounded-2xl">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className={`flex items-center justify-between gap-4 p-5 ${
                index < rows.length - 1 ? "border-b border-[var(--border-subtle)]" : ""
              }`}
            >
              <div className="flex min-w-0 flex-col gap-1">
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
                <span className="font-mono text-[13px] text-[var(--color-text-highlight)] select-none">
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
          ))}
        </GlassContainer>

        <div className="flex items-start gap-3 px-3 py-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
          <Icons.Info size={16} className="mt-0.5 shrink-0" />
          <span>{t("settings.storage.footerNote")}</span>
        </div>
      </div>
    </div>
  );
}
