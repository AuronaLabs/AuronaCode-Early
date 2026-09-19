import { type ComponentType, useCallback, useEffect, useState } from "react";
import { BaseDirectory, desktopFileSystem } from "../../Foundation/Desktop";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { StorageIPC } from "../../Foundation/IPC/StorageCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Badge } from "../../UI/Components/Badge";
import { Button } from "../../UI/Components/Button";
import { Modal } from "../../UI/Components/Modal";
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

/** t 函数类型：直接取自 useLocale 返回值，保证签名兼容 */
type TranslateFn = ReturnType<typeof useLocale>["t"];

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

/** 组色值同时用于堆叠条分段与明细行图标染色，统一取语义令牌。 */
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

/** 可安全清理聚合（总览高亮 + 一键清理的范围） */
const SAFE_CLEAR_TARGETS: ClearTarget[] = ["cache", "logs", "errlogs"];

/** 明细行定义：一个可清理目标对应一行 */
interface StorageRowDef {
  id: ClearTarget;
  nameKey: I18nKey;
  descriptionKey: I18nKey;
}

/** 明细列表顺序 = 分组顺序（组内保持旧行序），图标染色传达分组归属 */
const ROW_ORDER: StorageRowDef[] = [
  {
    id: "config",
    nameKey: "settings.storage.rows.config.name",
    descriptionKey: "settings.storage.rows.config.description",
  },
  {
    id: "workspace",
    nameKey: "settings.storage.rows.workspace.name",
    descriptionKey: "settings.storage.rows.workspace.description",
  },
  {
    id: "recovery",
    nameKey: "settings.storage.rows.recovery.name",
    descriptionKey: "settings.storage.rows.recovery.description",
  },
  {
    id: "performance",
    nameKey: "settings.storage.rows.performance.name",
    descriptionKey: "settings.storage.rows.performance.description",
  },
  {
    id: "extensionStorage",
    nameKey: "settings.storage.rows.extensionStorage.name",
    descriptionKey: "settings.storage.rows.extensionStorage.description",
  },
  {
    id: "toolchains",
    nameKey: "settings.storage.rows.toolchains.name",
    descriptionKey: "settings.storage.rows.toolchains.description",
  },
  {
    id: "cache",
    nameKey: "settings.storage.rows.cache.name",
    descriptionKey: "settings.storage.rows.cache.description",
  },
  {
    id: "logs",
    nameKey: "settings.storage.rows.logs.name",
    descriptionKey: "settings.storage.rows.logs.description",
  },
  {
    id: "errlogs",
    nameKey: "settings.storage.rows.errlogs.name",
    descriptionKey: "settings.storage.rows.errlogs.description",
  },
  {
    id: "other",
    nameKey: "settings.storage.rows.other.name",
    descriptionKey: "settings.storage.rows.other.description",
  },
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
  const [confirmTarget, setConfirmTarget] = useState<ClearTarget | null>(null);
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

  const rows = ROW_ORDER.map((row) => ({
    id: row.id,
    name: t(row.nameKey),
    description: t(row.descriptionKey),
    raw: (
      {
        config: sizes.configBytes,
        workspace: sizes.workspaceBytes,
        recovery: sizes.recoveryBytes,
        performance: sizes.performanceBytes,
        extensionStorage: sizes.extensionStorageBytes,
        toolchains: sizes.toolchainBytes,
        cache: sizes.cacheBytes,
        logs: sizes.logBytes,
        errlogs: sizes.errlogBytes,
        other: sizes.otherAppDataBytes,
      } as Record<ClearTarget, number>
    )[row.id],
  }));

  const totalRawSize = sizes.appDataBytes;
  const totalForBar = totalRawSize === 0 ? 1 : totalRawSize;
  const safeBytes = SAFE_CLEAR_TARGETS.reduce(
    (sum, target) => sum + (rows.find((row) => row.id === target)?.raw ?? 0),
    0,
  );

  const groupBytes = (group: StorageGroup) =>
    rows.filter((row) => ROW_GROUP[row.id] === group).reduce((sum, row) => sum + row.raw, 0);

  // 水平堆叠占比条：按组顺序线性分段（取代此前的 conic 环）
  const barStops: string[] = [];
  let barAcc = 0;
  for (const group of GROUP_META) {
    const start = barAcc;
    barAcc = Math.min(100, barAcc + (groupBytes(group.id) / totalForBar) * 100);
    barStops.push(`${group.color} ${start.toFixed(2)}% ${barAcc.toFixed(2)}%`);
  }
  const barBackground =
    totalRawSize === 0
      ? "var(--material-surface)"
      : `linear-gradient(to right, ${barStops.join(", ")})`;

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

      {/* 总览：单一焦点数字 + 可安全清理徽章 + 堆叠占比条（与设置页 raised 卡片同一语言） */}
      <GlassContainer layer="raised" className="flex flex-col gap-5 overflow-hidden p-5">
        <div className="flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5 select-none">
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.storage.localDataUsed")}
            </span>
            <span className="flex flex-wrap items-center gap-2.5">
              <span className="text-[22px] leading-none font-bold tracking-tight text-[var(--color-text-highlight)] tabular-nums">
                {formatBytes(totalRawSize)}
              </span>
              <Badge variant="tint">
                {t("settings.storage.safeToClean")} · {formatBytes(safeBytes)}
              </Badge>
            </span>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {t("settings.storage.appDataDir")}
            </span>
          </div>
          <Button
            variant="primary"
            className="h-8 shrink-0 px-4 text-[12px]"
            disabled={clearing !== null || safeBytes === 0}
            onClick={() => void clearSafeAll()}
          >
            {clearing === "safe" ? t("settings.storage.clearing") : t("settings.storage.cleanAll")}
          </Button>
        </div>

        {/* 堆叠占比条：6 组色分段，总占用为 0 时退化为中性面 */}
        <div
          className="h-2 w-full overflow-hidden rounded-full"
          style={{ background: barBackground }}
          role="img"
          aria-label={t("settings.storage.title")}
        />
        {/* 图例：单行紧凑排列（色点 + 组名） */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 select-none">
          {GROUP_META.map((group) => (
            <span
              key={group.id}
              className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              {t(group.nameKey)}
              <span className="tabular-nums opacity-70">{formatBytes(groupBytes(group.id))}</span>
            </span>
          ))}
        </div>

        <p className="border-t border-[var(--border-subtle)] pt-3 text-[11px] leading-4 text-[var(--color-text-muted)]/80 select-none">
          {t("settings.storage.note")}
        </p>
      </GlassContainer>

      {/* 明细列表：单一 raised 容器 + 统一行规格（border-t / min-h-14 / p-5），与全设置分区一致 */}
      <GlassContainer layer="raised" className="overflow-hidden">
        {rows.map((row, index) => {
          const group = GROUP_META.find((g) => g.id === ROW_GROUP[row.id]);
          const GroupIcon = group?.icon ?? Icons.Files;
          const groupColor = group?.color ?? "var(--color-accent)";
          const isDanger = row.id === "config" || row.id === "workspace";
          return (
            <div
              key={row.id}
              className={`flex min-h-14 items-center gap-4 p-5 ${
                index > 0 ? "border-t border-[var(--border-subtle)]" : ""
              }`}
            >
              <span
                className="grid size-8 shrink-0 place-items-center rounded-lg"
                style={{
                  backgroundColor: `color-mix(in srgb, ${groupColor} 12%, transparent)`,
                  color: groupColor,
                }}
              >
                <GroupIcon size={15} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium text-[var(--color-text-highlight)] select-none">
                  {row.name}
                </span>
                <span className="truncate text-[11px] text-[var(--color-text-muted)]">
                  {row.description}
                </span>
              </div>
              <span className="shrink-0 text-[12.5px] tabular-nums text-[var(--color-text-secondary)] select-none">
                {formatBytes(row.raw)}
              </span>
              <Button
                variant={isDanger ? "danger" : "glass"}
                className="h-7 shrink-0 px-2.5 text-[11px]"
                disabled={clearing !== null || row.raw === 0}
                onClick={() => (isDanger ? setConfirmTarget(row.id) : void clear(row.id))}
              >
                {clearing === row.id ? t("settings.storage.clearing") : t("settings.storage.clear")}
              </Button>
            </div>
          );
        })}
      </GlassContainer>

      {/* 退出清理开关（统一行规格） */}
      <GlassContainer layer="raised" className="overflow-hidden">
        <div className="flex min-h-14 items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] font-medium text-[var(--color-text-highlight)] select-none">
              {t("settings.storage.exitCleanupTitle")}
            </span>
            <span className="text-[11px] leading-4 text-[var(--color-text-muted)]">
              {t("settings.storage.exitCleanupDescription")}
            </span>
          </div>
          <Switch
            checked={exitCleanup}
            onCheckedChange={handleExitCleanupToggle}
            aria-label={t("settings.storage.exitCleanupTitle")}
          />
        </div>
      </GlassContainer>

      <div className="flex items-start gap-3 px-3 py-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        <Icons.Info size={16} className="mt-0.5 shrink-0" />
        <span>{t("settings.storage.footerNote")}</span>
      </div>

      <Modal
        isOpen={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        title={t("settings.storage.confirmTitle")}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmTarget(null)}
              className="text-[12px]"
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="text-[12px]"
              onClick={() => {
                const target = confirmTarget;
                setConfirmTarget(null);
                if (target) void clear(target);
              }}
            >
              {t("common.confirm")}
            </Button>
          </div>
        }
      >
        <p className="text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
          {confirmTarget === "config"
            ? t("settings.storage.confirmConfigDescription")
            : t("settings.storage.confirmWorkspaceDescription")}
        </p>
      </Modal>
    </div>
  );
}
