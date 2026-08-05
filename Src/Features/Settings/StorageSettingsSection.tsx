import { useCallback, useEffect, useState } from "react";
import { BaseDirectory, desktopFileSystem } from "../../Foundation/Desktop";
import { StorageIPC } from "../../Foundation/IPC/StorageCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";

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
          showToast("用户配置文件已清除，重启后恢复默认", "success");
          break;
        case "workspace":
          await desktopFileSystem.remove("workspace.json", {
            baseDir: BaseDirectory.AppLocalData,
          });
          WorkspaceStore.resetCache();
          localStorage.clear();
          showToast("工作区状态已清理，重启后将重置布局", "success");
          break;
        case "recovery":
          await StorageIPC.clearEditorRecovery();
          showToast("编辑器恢复快照已清理", "success");
          break;
        case "cache":
          await StorageIPC.clearWebviewCache();
          showToast("WebView 缓存已清理，下次启动会自动重建", "success");
          break;
        case "logs":
          await StorageIPC.clearAppLogs();
          showToast("运行日志已清理", "success");
          break;
        case "errlogs":
          await StorageIPC.clearErrLogs();
          showToast("错误日志已清理", "success");
          break;
        case "performance":
          await StorageIPC.clearPerformanceBaseline();
          showToast("性能基线已重置，下次测试会重新建立", "success");
          break;
        case "other":
          await StorageIPC.clearOtherAppData();
          showToast("已清理其他残留数据，部分占用可能需重启后释放", "success");
          break;
      }
      await loadSizes();
    } catch (error) {
      showToast(`清理失败：${String(error)}`, "error");
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
    color: string;
    danger?: boolean;
  }[] = [
    {
      id: "config",
      name: "用户配置偏好",
      file: "user-config.json",
      description: "主题、外观、字体、语言服务等个人设置；清理后重启恢复默认",
      raw: sizes.configBytes,
      color: "bg-emerald-500/85",
      danger: true,
    },
    {
      id: "workspace",
      name: "工作区状态",
      file: "workspace.json",
      description: "最近打开的文件夹、标签页与界面布局记忆；清理后重启重置布局",
      raw: sizes.workspaceBytes,
      color: "bg-amber-500/85",
      danger: true,
    },
    {
      id: "recovery",
      name: "编辑器恢复快照",
      file: "editor-recovery/",
      description: "异常关闭后用于恢复未保存文档；确认不需要恢复内容再清理",
      raw: sizes.recoveryBytes,
      color: "bg-violet-500/85",
      danger: true,
    },
    {
      id: "cache",
      name: "WebView 渲染缓存",
      file: "EBWebView/",
      description: "WebView2 的缓存与临时文件，通常是占用最大的部分；清理后下次启动自动重建",
      raw: sizes.cacheBytes,
      color: "bg-sky-500/85",
    },
    {
      id: "logs",
      name: "运行日志",
      file: "logs/",
      description: "应用生命周期、Tauri 进程与终端控制台的诊断日志",
      raw: sizes.logBytes,
      color: "bg-fuchsia-500/85",
    },
    {
      id: "errlogs",
      name: "错误日志",
      file: "errlogs/",
      description: "崩溃与错误诊断记录，排查问题后可以安全清理",
      raw: sizes.errlogBytes,
      color: "bg-red-500/85",
    },
    {
      id: "performance",
      name: "性能基线",
      file: "performance-baseline.json",
      description: "本地性能对比基线数据；清理后下次测试重新建立",
      raw: sizes.performanceBytes,
      color: "bg-teal-500/85",
    },
    {
      id: "other",
      name: "其他本地数据",
      file: "AppLocalData",
      description: "未被上面分类的小型残留文件",
      raw: sizes.otherAppDataBytes,
      color: "bg-[var(--color-accent)]",
    },
  ];

  const totalRawSize = sizes.appDataBytes;
  const totalFormatted = formatBytes(totalRawSize);
  const totalForBar = totalRawSize === 0 ? 1 : totalRawSize;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">存储空间管理</h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          按真实目录监控并清理 Aurona Code 占用的磁盘空间
        </p>
      </div>

      <GlassContainer layer="elevated" className="flex flex-col gap-6 rounded-2xl p-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-end justify-between">
            <span className="text-[20px] font-extrabold tracking-tight text-[var(--color-text-highlight)] select-none">
              {totalFormatted}{" "}
              <span className="font-sans text-[12px] font-normal text-[var(--color-text-muted)]">
                本地数据已使用
              </span>
            </span>
            <span className="text-[12px] font-medium text-[var(--color-text-muted)] select-none">
              应用本地数据目录
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
                  className={`h-full ${row.color} transition-opacity hover:opacity-80`}
                  style={{ width: `${(row.raw / totalForBar) * 100}%` }}
                />
              ) : null,
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 select-none">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]"
              >
                <div className={`h-2 w-2 rounded-full ${row.color}`} />
                <span>
                  {row.name} ({formatBytes(row.raw)})
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[var(--color-text-muted)]">
            以上条目对应应用本地数据目录中的真实文件与文件夹；WebView 缓存清理后由 WebView2
            自动重建，配置、工作区状态与恢复快照属于核心数据，请谨慎清理。
          </p>
        </div>
      </GlassContainer>

      <div className="mt-2 flex flex-col gap-4">
        <h4 className="px-1 text-[13px] font-bold text-[var(--color-text-highlight)]">
          存储细分与清理
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
                  {clearing === row.id ? "清理中..." : "清理"}
                </Button>
              </div>
            </div>
          ))}
        </GlassContainer>

        <div className="flex items-start gap-3 px-3 py-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
          <Icons.Info size={16} className="mt-0.5 shrink-0" />
          <span>
            正在被应用使用的文件可能无法立即删除，清理后再次打开页面会显示最新占用。
            重置全部应用数据请前往「高级设置 → 初始化重置」。
          </span>
        </div>
      </div>
    </div>
  );
}
