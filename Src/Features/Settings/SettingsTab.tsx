import { useCallback, useEffect, useState } from "react";
import { ACCENT_THEMES, applyAccentTheme } from "../../App/ThemeAccent";
import { UpdaterService } from "../../Core/UpdaterService";
import { BaseDirectory, desktopFileSystem, invokeDesktop } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { GitIPC } from "../../Foundation/IPC/GitCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import type { AccentThemeId } from "../../Foundation/Types/Config";
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer, type GlassIntensity, useGlassStore } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";

export type SettingsSection = "appearance" | "editor" | "terminal" | "git" | "storage" | "advanced";

interface StorageBreakdown {
  appDataBytes: number;
  logBytes: number;
  configBytes: number;
  workspaceBytes: number;
  recoveryBytes: number;
  otherAppDataBytes: number;
}

export function SettingsTab() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const intensity = useGlassStore((state) => state.intensity);
  const setIntensity = useGlassStore((state) => state.setIntensity);

  useEffect(() => {
    const unsub = EventBus.on("settings:nav", (section: SettingsSection) => {
      setActiveSection(section);
    });
    return () => unsub();
  }, []);

  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [accentTheme, setAccentTheme] = useState<AccentThemeId>("aurora");
  const [accentInBackground, setAccentInBackground] = useState(false);

  const [editorFontSize, setEditorFontSize] = useState("14");
  const [editorLineHeight, setEditorLineHeight] = useState("24");
  const [editorTabSize, setEditorTabSize] = useState("2");
  const [editorWordWrap, setEditorWordWrap] = useState("on");

  const [terminalFontSize, setTerminalFontSize] = useState("13");
  const [terminalCursorBlink, setTerminalCursorBlink] = useState("true");

  useEffect(() => {
    UserConfigStore.get().then((config) => {
      const savedTheme = config.theme as "light" | "dark" | "system" | undefined;
      if (savedTheme) setTheme(savedTheme);
      const savedAccent = config.accentTheme ?? "aurora";
      const savedAccentInBackground = config.accentInBackground ?? false;
      setAccentTheme(savedAccent);
      setAccentInBackground(savedAccentInBackground);
      applyAccentTheme(savedAccent, savedAccentInBackground);

      const savedEditorFont = config.editorFontSize?.toString() || "14";
      const savedEditorLineHeight = config.editorLineHeight?.toString() || "24";
      const savedEditorTabSize = config.editorTabSize?.toString() || "2";
      const savedTerminalFont = config.terminalFontSize?.toString() || "13";
      setEditorFontSize(savedEditorFont);
      setEditorLineHeight(savedEditorLineHeight);
      setEditorTabSize(savedEditorTabSize);
      setEditorWordWrap(config.editorWordWrap || "on");

      setTerminalFontSize(savedTerminalFont);
      setTerminalCursorBlink(config.terminalCursorBlink !== false ? "true" : "false");

      document.documentElement.style.setProperty("--EditorFontSize", `${savedEditorFont}px`);
      document.documentElement.style.setProperty(
        "--EditorLineHeight",
        `${savedEditorLineHeight}px`,
      );
      document.documentElement.style.setProperty("--EditorTabSize", savedEditorTabSize);
      document.documentElement.style.setProperty("--TerminalFontSize", `${savedTerminalFont}px`);
    });
  }, []);

  const handleThemeChange = (newTheme: "light" | "dark" | "system") => {
    setTheme(newTheme);
    const isDark =
      newTheme === "dark" ||
      (newTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    document.documentElement.classList.toggle("dark", isDark);
    UserConfigStore.set({ theme: newTheme });
  };

  const handleAccentThemeChange = (nextAccent: AccentThemeId) => {
    setAccentTheme(nextAccent);
    applyAccentTheme(nextAccent, accentInBackground);
    void UserConfigStore.set({ accentTheme: nextAccent });
  };

  const handleAccentBackgroundChange = (enabled: boolean) => {
    setAccentInBackground(enabled);
    applyAccentTheme(accentTheme, enabled);
    void UserConfigStore.set({ accentInBackground: enabled });
  };

  const [repoPath, setRepoPath] = useState<string | null>(
    WorkspaceStore.getCached()?.lastOpenedPath || null,
  );
  const [remoteUrl, setRemoteUrl] = useState("");
  const [isSavingGit, setIsSavingGit] = useState(false);
  const [_isGitLoading, setIsGitLoading] = useState(true);

  const [configSize, setConfigSize] = useState("0 B");
  const [workspaceSize, setWorkspaceSize] = useState("0 B");
  const [otherDataSize, setOtherDataSize] = useState("0 B");
  const [recoverySize, setRecoverySize] = useState("0 B");
  const [_appDataSize, setAppDataSize] = useState("0 B");
  const [logSize, setLogSize] = useState("0 B");
  const [rawConfigSize, setRawConfigSize] = useState(0);
  const [rawWorkspaceSize, setRawWorkspaceSize] = useState(0);
  const [rawOtherDataSize, setRawOtherDataSize] = useState(0);
  const [rawRecoverySize, setRawRecoverySize] = useState(0);
  const [rawAppDataSize, setRawAppDataSize] = useState(0);
  const [rawLogSize, setRawLogSize] = useState(0);
  const [isClearing, setIsClearing] = useState<string | null>(null);

  const formatBytes = useCallback((bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
  }, []);

  const loadStorageSizes = useCallback(async () => {
    try {
      const breakdown = await invokeDesktop<StorageBreakdown>("get_storage_breakdown");
      setConfigSize(formatBytes(breakdown.configBytes));
      setRawConfigSize(breakdown.configBytes);
      setWorkspaceSize(formatBytes(breakdown.workspaceBytes));
      setRawWorkspaceSize(breakdown.workspaceBytes);
      setRecoverySize(formatBytes(breakdown.recoveryBytes));
      setRawRecoverySize(breakdown.recoveryBytes);
      setOtherDataSize(formatBytes(breakdown.otherAppDataBytes));
      setRawOtherDataSize(breakdown.otherAppDataBytes);
      setAppDataSize(formatBytes(breakdown.appDataBytes));
      setRawAppDataSize(breakdown.appDataBytes);
      setLogSize(formatBytes(breakdown.logBytes));
      setRawLogSize(breakdown.logBytes);
    } catch {
      setAppDataSize("0 B");
      setRawAppDataSize(0);
      setConfigSize("0 B");
      setRawConfigSize(0);
      setWorkspaceSize("0 B");
      setRawWorkspaceSize(0);
      setRecoverySize("0 B");
      setRawRecoverySize(0);
      setOtherDataSize("0 B");
      setRawOtherDataSize(0);
      setLogSize("0 B");
      setRawLogSize(0);
    }
  }, [formatBytes]);

  useEffect(() => {
    if (activeSection === "storage") {
      loadStorageSizes();
    }
  }, [activeSection, loadStorageSizes]);

  const handleClearConfig = async () => {
    setIsClearing("config");
    try {
      await desktopFileSystem.remove("user-config.json", { baseDir: BaseDirectory.AppLocalData });
      UserConfigStore.resetCache();
      showToast("用户配置文件已清除，重启后恢复默认", "success");
      loadStorageSizes();
    } catch (e) {
      showToast(`清除失败: ${e}`, "error");
    } finally {
      setIsClearing(null);
    }
  };

  const handleClearWorkspace = async () => {
    setIsClearing("workspace");
    try {
      await desktopFileSystem.remove("workspace.json", { baseDir: BaseDirectory.AppLocalData });
      WorkspaceStore.resetCache();
      localStorage.clear();
      showToast("工作区缓存已清理，重启后将重置界面布局", "success");
      loadStorageSizes();
    } catch (e) {
      showToast(`清除失败: ${e}`, "error");
    } finally {
      setIsClearing(null);
    }
  };

  const handleClearOtherAppData = async () => {
    setIsClearing("other");
    try {
      await invokeDesktop("clear_other_app_data");
      showToast("已清理其他缓存数据与碎片，部分可能需重启后释放", "success");
      loadStorageSizes();
    } catch (e) {
      showToast(`清除时发生错误: ${e}`, "warning");
      loadStorageSizes(); // Still reload because some files might have been deleted
    } finally {
      setIsClearing(null);
    }
  };

  const handleClearRecovery = async () => {
    setIsClearing("recovery");
    try {
      await invokeDesktop("clear_editor_recovery");
      await loadStorageSizes();
      showToast("编辑器恢复快照已清理", "success");
    } catch (error) {
      showToast(`清理恢复快照失败: ${error}`, "error");
    } finally {
      setIsClearing(null);
    }
  };

  const handleClearLogs = async () => {
    setIsClearing("logs");
    try {
      await invokeDesktop("clear_app_logs");
      await loadStorageSizes();
      showToast("运行日志已清理完毕", "success");
    } catch (_e) {
      showToast(`没有发现可清理的日志`, "warning");
    } finally {
      setIsClearing(null);
    }
  };

  useEffect(() => {
    if (activeSection !== "git") return;
    const loadGitConfig = async () => {
      setIsGitLoading(true);
      await WorkspaceStore.init();
      const config = await WorkspaceStore.get();
      if (config.lastOpenedPath) {
        setRepoPath(config.lastOpenedPath);
        try {
          const url = await GitIPC.getRemote(config.lastOpenedPath);
          if (url) {
            try {
              const urlObj = new URL(url);
              urlObj.username = "";
              urlObj.password = "";
              setRemoteUrl(urlObj.toString());
            } catch {
              setRemoteUrl(url);
            }
          }
        } catch (e) {
          console.error(e);
        }
      } else {
        setRepoPath(null);
        showToast("当前工作区未打开任何有效的 Git 项目", "warning");
      }
      setIsGitLoading(false);
    };
    loadGitConfig();
  }, [activeSection]);

  const handleSaveGit = async () => {
    if (!repoPath || !remoteUrl.trim()) {
      showToast("请填写远程仓库地址", "error");
      return;
    }
    setIsSavingGit(true);
    try {
      const finalUrl = remoteUrl.trim();
      try {
        const urlObj = new URL(finalUrl);
        if (urlObj.username || urlObj.password) {
          showToast(
            "请使用 Git Credential Manager 或 SSH 密钥管理凭据，不要将凭据写入远程地址",
            "error",
          );
          return;
        }
      } catch {
        // SCP-like SSH remote URLs are valid Git remote URLs and do not expose URL credentials.
      }
      await GitIPC.setRemote(repoPath, finalUrl);
      showToast("远程仓库地址已成功更新", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`保存失败: ${message}`, "error");
    } finally {
      setIsSavingGit(false);
    }
  };

  const renderAppearance = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">外观与色彩</h3>
        <p className="text-[13px] text-[var(--TextMuted)]">
          在同一处调整界面模式、工作台色彩与背景氛围
        </p>
      </div>

      <div className="glass-inner-card rounded-2xl overflow-hidden shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">外观模式</span>
            <span className="text-[12px] text-[var(--TextMuted)]">更改编辑器的整体色彩倾向</span>
          </div>
          <fieldset className="grid w-full grid-cols-3 gap-1 rounded-2xl border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] p-1.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)] backdrop-blur-[var(--glass-blur-base)] sm:w-auto">
            <legend className="sr-only">外观模式</legend>
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                type="button"
                aria-pressed={theme === t}
                key={t}
                onClick={() => handleThemeChange(t)}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 sm:min-w-[104px] ${
                  theme === t
                    ? "border-[var(--GlassBorder)] bg-[var(--GlassActive)] text-[var(--TextHighlight)] shadow-[0_4px_14px_rgba(15,23,42,0.08)] backdrop-blur-[var(--glass-blur-elevated)]"
                    : "border-transparent text-[var(--TextMuted)] hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)]"
                }`}
              >
                {t === "system" && (
                  <>
                    <Icons.Monitor size={16} /> 跟随系统
                  </>
                )}
                {t === "light" && (
                  <>
                    <Icons.Sun size={16} /> 浅色
                  </>
                )}
                {t === "dark" && (
                  <>
                    <Icons.Moon size={16} /> 深色
                  </>
                )}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="border-t border-[var(--GlassBorder)] p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-1 px-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">色彩主题</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              统一影响交互强调、焦点、状态反馈与可选的背景氛围
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ACCENT_THEMES.map((accent) => {
              const selected = accentTheme === accent.id;
              return (
                <button
                  type="button"
                  key={accent.id}
                  aria-pressed={selected}
                  onClick={() => handleAccentThemeChange(accent.id)}
                  className={`group relative flex min-h-[68px] overflow-hidden rounded-xl border p-2.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ${
                    selected
                      ? "border-[color-mix(in_srgb,var(--AccentPrimary)_32%,var(--GlassBorder))] bg-[var(--GlassActive)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--AccentPrimary)_14%,transparent),var(--shadow-surface)]"
                      : "border-transparent bg-[var(--GlassSurface-Base)] hover:border-[var(--GlassBorder)] hover:bg-[var(--GlassHover)] hover:-translate-y-px"
                  }`}
                >
                  <span
                    className="absolute -right-3 -top-3 h-14 w-14 rounded-full opacity-90 blur-[1px] transition-transform duration-200 group-hover:scale-110"
                    style={{ backgroundColor: `rgb(${accent.rgb})` }}
                  />
                  <span className="relative flex min-w-0 flex-1 flex-col gap-1">
                    <span className="h-1.5 w-8 rounded-full bg-[var(--TextHighlight)]/12" />
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold text-[var(--TextHighlight)]">
                        {accent.label}
                      </span>
                      {accent.isDefault && (
                        <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--AccentPrimary)_14%,transparent)] px-1 py-0.5 text-[9px] font-semibold leading-none text-[var(--AccentPrimary)]">
                          默认
                        </span>
                      )}
                    </span>
                  </span>
                  {selected && (
                    <Icons.Check
                      className="relative shrink-0 text-[var(--TextHighlight)]"
                      size={15}
                      stroke={2.5}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] px-3.5 py-3">
            <div className="min-w-0 pr-2">
              <span className="text-[12px] font-medium text-[var(--TextHighlight)]">
                背景同步渲染
              </span>
              <p className="mt-0.5 text-[11px] leading-4 text-[var(--TextMuted)]">
                让当前色彩主题轻柔融入工作台背景渐变
              </p>
            </div>
            <Switch
              checked={accentInBackground}
              onCheckedChange={handleAccentBackgroundChange}
              aria-label="将色彩主题同步到背景渐变"
            />
          </div>
        </div>
      </div>

      {/*
      <div
  className =
    "flex flex-col gap-2 mt-6" >
    <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">视觉效果</h3> <
    p;
  className = "text-[13px] text-[var(--TextMuted)]" > 调整界面元素的玻璃拟物;
  （毛玻璃）效果强度
        </p>
      </div>

      <div className="glass-inner-card rounded-2xl overflow-hidden shadow-sm mt-2">
        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">拟物强度</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              配置全局毛玻璃的模糊与透明度
            </span>
          </div>
          <Select
            value=
  intensity;
  onChange={(value) => setIntensity(value as GlassIntensity)}
  className = "w-[140px] shrink-0";
  options={[
              { value: "light", label: "Light" },
              { value: "medium", label: "Medium" },
              { value: "heavy", label: "Heavy" },
            ]}
          />
  </div>
      </div>
    </div>
      */}

      <div className="mt-6 flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">视觉效果</h3>
        <p className="text-[13px] text-[var(--TextMuted)]">
          调整界面元素的玻璃拟物（毛玻璃）效果强度
        </p>
      </div>

      <div className="mt-2 overflow-hidden rounded-2xl shadow-sm glass-inner-card">
        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">拟物强度</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              配置全局毛玻璃的模糊与透明度
            </span>
          </div>
          <Select
            value={intensity}
            onChange={(value) => setIntensity(value as GlassIntensity)}
            className="w-[140px] shrink-0"
            options={[
              { value: "light", label: "Light" },
              { value: "medium", label: "Medium" },
              { value: "heavy", label: "Heavy" },
            ]}
          />
        </div>
      </div>
    </div>
  );

  const renderEditor = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">编辑器设置</h3>
        <p className="text-[13px] text-[var(--TextMuted)]">配置代码编辑器的外观和行为</p>
      </div>

      <div className="glass-inner-card rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--GlassBorder)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">字体大小</span>
            <span className="text-[12px] text-[var(--TextMuted)]">控制编辑器的主代码字体大小</span>
          </div>
          <Select
            value={editorFontSize}
            className="w-[140px] shrink-0"
            onChange={(val: string) => {
              setEditorFontSize(val);
              UserConfigStore.set({ editorFontSize: parseInt(val, 10) });
              document.documentElement.style.setProperty("--EditorFontSize", `${val}px`);
              EventBus.emit("settings:editor-changed");
            }}
            options={[12, 13, 14, 15, 16, 18, 20].map((size) => ({
              value: size.toString(),
              label: `${size}px`,
            }))}
          />
        </div>

        <div className="flex items-center justify-between border-b border-[var(--GlassBorder)] p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">行高</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              调整代码行间距，并同步光标与选择坐标
            </span>
          </div>
          <Select
            value={editorLineHeight}
            className="w-[140px] shrink-0"
            onChange={(value) => {
              setEditorLineHeight(value);
              UserConfigStore.set({ editorLineHeight: Number(value) });
              document.documentElement.style.setProperty("--EditorLineHeight", `${value}px`);
            }}
            options={[20, 22, 24, 26, 28, 30].map((value) => ({
              value: String(value),
              label: `${value}px`,
            }))}
          />
        </div>

        <div className="flex items-center justify-between border-b border-[var(--GlassBorder)] p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">Tab 宽度</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              控制 Tab 字符的视觉宽度与点击定位
            </span>
          </div>
          <Select
            value={editorTabSize}
            className="w-[140px] shrink-0"
            onChange={(value) => {
              setEditorTabSize(value);
              UserConfigStore.set({ editorTabSize: Number(value) });
              document.documentElement.style.setProperty("--EditorTabSize", value);
            }}
            options={[2, 4, 8].map((value) => ({ value: String(value), label: `${value} spaces` }))}
          />
        </div>

        <div className="flex items-center justify-between p-5 border-b border-[var(--GlassBorder)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">自动换行</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              当代码超出一行长度时自动折行显示
            </span>
          </div>
          <Switch
            checked={editorWordWrap === "on"}
            onCheckedChange={(checked) => {
              const val = checked ? "on" : "off";
              setEditorWordWrap(val);
              UserConfigStore.set({ editorWordWrap: val });
              EventBus.emit("settings:editor-changed");
            }}
          />
        </div>

        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">代码缩略图</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              当前轻量编辑器内核暂不支持缩略图；该选项将在完整实现后再开放
            </span>
          </div>
          <span className="rounded-lg border border-[var(--GlassBorder)] px-3 py-1.5 text-[12px] text-[var(--TextMuted)]">
            暂不可用
          </span>
        </div>
      </div>
    </div>
  );

  const renderTerminal = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">终端设置</h3>
        <p className="text-[13px] text-[var(--TextMuted)]">自定义集成终端的显示效果</p>
      </div>

      <div className="glass-inner-card rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--GlassBorder)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">字体大小</span>
            <span className="text-[12px] text-[var(--TextMuted)]">控制终端控制台的字体大小</span>
          </div>
          <Select
            value={terminalFontSize}
            className="w-[140px] shrink-0"
            onChange={(val: string) => {
              setTerminalFontSize(val);
              UserConfigStore.set({ terminalFontSize: parseInt(val, 10) });
              document.documentElement.style.setProperty("--TerminalFontSize", `${val}px`);
              EventBus.emit("settings:terminal-changed");
            }}
            options={[12, 13, 14, 15, 16, 18, 20].map((size) => ({
              value: size.toString(),
              label: `${size}px`,
            }))}
          />
        </div>

        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">光标闪烁</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              是否开启终端光标的呼吸闪烁效果
            </span>
          </div>
          <Switch
            checked={terminalCursorBlink === "true"}
            onCheckedChange={(checked) => {
              const val = checked ? "true" : "false";
              setTerminalCursorBlink(val);
              UserConfigStore.set({ terminalCursorBlink: checked });
              EventBus.emit("settings:terminal-changed");
            }}
          />
        </div>
      </div>
    </div>
  );

  const renderGit = () => (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">远程仓库配置</h3>
        <p className="text-[13px] text-[var(--TextMuted)]">
          配置当前工作区 Git 仓库的远程拉取和推送地址及凭据
        </p>
      </div>

      {!repoPath ? (
        <GlassContainer
          layer="elevated"
          className="mt-2 flex max-w-md flex-col items-center justify-center gap-4 rounded-2xl p-6 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--GlassBorder)] bg-[var(--GlassActive)] text-[var(--TextHighlight)] shadow-sm">
            <Icons.Git size={22} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-[14px] font-bold text-[var(--TextHighlight)]">
              未检测到 Git 工作区
            </h4>
            <p className="text-[12px] leading-relaxed text-[var(--TextMuted)]">
              当前未在工作区打开任何有效的目录。请先在资源管理器中打开包含 Git
              仓库的文件夹，然后在此处配置凭据。
            </p>
          </div>
        </GlassContainer>
      ) : (
        <div className="glass-inner-card mt-2 flex max-w-3xl flex-col overflow-hidden rounded-2xl">
          <div className="flex items-center gap-3 border-b border-[var(--GlassBorder)] px-5 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--GlassBorder)] bg-[var(--GlassActive)] text-[var(--TextHighlight)] shadow-sm">
              <Icons.Git size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[var(--TextHighlight)]">
                当前工作区仓库
              </div>
              <div className="truncate text-[11px] text-[var(--TextMuted)]">{repoPath}</div>
            </div>
            <span className="rounded-full border border-[var(--GlassBorder)] bg-[var(--GlassHover)] px-2.5 py-1 text-[10px] font-medium text-[var(--TextMuted)]">
              本地配置
            </span>
          </div>

          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-semibold text-[var(--TextHighlight)]">
                    远程仓库地址
                  </span>
                  <span className="text-[11px] text-[var(--TextMuted)]">
                    用于当前仓库的拉取与推送
                  </span>
                </div>
                <Icons.Github size={18} className="shrink-0 text-[var(--TextMuted)]" />
              </div>
              <div className="rounded-xl border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] p-1 focus-within:border-[var(--TextMuted)]/25 focus-within:ring-2 focus-within:ring-[var(--TextMuted)]/20">
                <Input
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  fullWidth
                  surface="embedded"
                  inputSize="lg"
                />
              </div>
            </div>

            <div className="flex items-start gap-3 px-3 py-1 text-[11.5px] leading-relaxed text-[var(--TextMuted)]">
              <Icons.Info size={16} className="mt-0.5 shrink-0" />
              <span>
                凭据由 Git Credential Manager、系统钥匙串或 SSH 密钥管理。Aurona Code
                不会将用户名、密码或 Token 写入远程地址。
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[var(--GlassBorder)] px-5 py-4">
            <span className="text-[12px] text-[var(--TextMuted)]">
              仅修改当前仓库的 Git remote 配置
            </span>
            <Button
              variant="glass"
              onClick={handleSaveGit}
              disabled={isSavingGit || !remoteUrl.trim()}
            >
              <Icons.Save size={14} />
              {isSavingGit ? "正在应用..." : "应用更改"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const renderStorage = () => {
    const totalRawSize = rawAppDataSize + rawLogSize;
    const totalSizeFormatted = formatBytes(totalRawSize);

    const totalForBar = totalRawSize === 0 ? 1 : totalRawSize;
    const configPct = (rawConfigSize / totalForBar) * 100;
    const workspacePct = (rawWorkspaceSize / totalForBar) * 100;
    const recoveryPct = (rawRecoverySize / totalForBar) * 100;
    const otherPct = (rawOtherDataSize / totalForBar) * 100;
    const logPct = (rawLogSize / totalForBar) * 100;

    return (
      <div className="flex flex-col gap-6 w-full max-w-3xl">
        <div className="flex flex-col gap-2">
          <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">存储空间管理</h3>
          <p className="text-[13px] text-[var(--TextMuted)]">
            监控并清理 Aurona Code 占用的磁盘存储空间
          </p>
        </div>

        <div className="glass-inner-card flex flex-col gap-6 rounded-2xl p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
              <span className="text-[20px] font-extrabold text-[var(--TextHighlight)] tracking-tight select-none">
                {totalSizeFormatted}{" "}
                <span className="text-[12px] font-normal text-[var(--TextMuted)] font-sans">
                  本地数据已使用
                </span>
              </span>
              <span className="text-[12px] text-[var(--TextMuted)] font-medium select-none">
                已统计应用数据与运行日志
              </span>
            </div>

            <div className="flex h-3.5 w-full select-none overflow-hidden rounded-full border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] p-px shadow-[inset_0_1px_2px_rgb(15_23_42_/_12%)]">
              {totalRawSize === 0 && (
                <div
                  className="h-full rounded-full bg-[var(--GlassSurface-Elevated)]"
                  style={{ width: "100%" }}
                />
              )}
              {rawConfigSize > 0 && (
                <div
                  className="h-full rounded-full bg-emerald-500/85 transition-opacity hover:opacity-80"
                  style={{ width: `${configPct}%` }}
                />
              )}
              {rawWorkspaceSize > 0 && (
                <div
                  className="h-full bg-amber-500/85 transition-opacity hover:opacity-80"
                  style={{ width: `${workspacePct}%` }}
                />
              )}
              {rawOtherDataSize > 0 && (
                <div
                  className="h-full bg-[var(--AccentPrimary)] transition-opacity hover:opacity-80"
                  style={{ width: `${otherPct}%` }}
                />
              )}
              {rawRecoverySize > 0 && (
                <div
                  className="h-full bg-violet-500/85 transition-opacity hover:opacity-80"
                  style={{ width: `${recoveryPct}%` }}
                />
              )}
              {rawLogSize > 0 && (
                <div
                  className="h-full bg-fuchsia-500/85 transition-opacity hover:opacity-80"
                  style={{ width: `${logPct}%` }}
                />
              )}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-1 select-none">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--TextMuted)]">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>配置偏好 ({configSize})</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--TextMuted)]">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span>工作区缓存 ({workspaceSize})</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--TextMuted)]">
                <div className="h-2 w-2 rounded-full bg-[var(--AccentPrimary)]" />
                <span>其他数据 ({otherDataSize})</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--TextMuted)]">
                <div className="h-2 w-2 rounded-full bg-violet-500/85" />
                <span>恢复快照 ({recoverySize})</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--TextMuted)]">
                <div className="h-2 w-2 rounded-full bg-fuchsia-500/85" />
                <span>运行日志 ({logSize})</span>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-[var(--TextMuted)]">
              统计范围为 Aurona 可安全管理的应用数据与运行日志；系统 WebView
              配置文件由操作系统管理，不会被这里的清理操作影响。
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 mt-2">
          <h4 className="text-[13px] font-bold text-[var(--TextHighlight)] px-1">存储细分与清理</h4>

          <div className="glass-inner-card rounded-2xl overflow-hidden shadow-sm flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-[var(--GlassBorder)]">
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-medium text-[var(--TextHighlight)] flex items-center gap-2 select-none">
                  用户配置偏好
                  <span className="text-[11px] text-[var(--TextMuted)] font-normal font-mono bg-[var(--GlassSurface-Elevated)] px-2 py-0.5 rounded-lg">
                    user-config.json
                  </span>
                </span>
                <span className="text-[12px] text-[var(--TextMuted)]">
                  保存当前编辑器的全部个性化设置、字号大小与主题外观偏好
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[13px] font-mono text-[var(--TextHighlight)] select-none">
                  {configSize}
                </span>
                <Button
                  variant="danger"
                  className="h-8 text-[12px] px-3.5"
                  disabled={isClearing !== null || rawConfigSize === 0}
                  onClick={handleClearConfig}
                >
                  {isClearing === "config" ? "正在清理..." : "清理"}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--GlassBorder)] p-5">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[14px] font-medium text-[var(--TextHighlight)] select-none">
                  编辑器恢复快照
                  <span className="rounded-lg bg-[var(--GlassSurface-Elevated)] px-2 py-0.5 font-mono text-[11px] font-normal text-[var(--TextMuted)]">
                    editor-recovery
                  </span>
                </span>
                <span className="text-[12px] text-[var(--TextMuted)]">
                  用于在异常关闭后恢复未保存的文档；仅在确认不需要恢复内容时清理。
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="select-none font-mono text-[13px] text-[var(--TextHighlight)]">
                  {recoverySize}
                </span>
                <Button
                  variant="danger"
                  className="h-8 px-3.5 text-[12px]"
                  disabled={isClearing !== null || rawRecoverySize === 0}
                  onClick={handleClearRecovery}
                >
                  {isClearing === "recovery" ? "正在清理..." : "清理"}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between p-5 border-b border-[var(--GlassBorder)]">
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-medium text-[var(--TextHighlight)] flex items-center gap-2 select-none">
                  最近工作区状态
                  <span className="text-[11px] text-[var(--TextMuted)] font-normal font-mono bg-[var(--GlassSurface-Elevated)] px-2 py-0.5 rounded-lg">
                    workspace.json
                  </span>
                </span>
                <span className="text-[12px] text-[var(--TextMuted)]">
                  记录最近打开的文件夹列表、当前打开的编辑标签页与界面布局缓存
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[13px] font-mono text-[var(--TextHighlight)] select-none">
                  {workspaceSize}
                </span>
                <Button
                  variant="danger"
                  className="h-8 text-[12px] px-3.5"
                  disabled={isClearing !== null || rawWorkspaceSize === 0}
                  onClick={handleClearWorkspace}
                >
                  {isClearing === "workspace" ? "正在清理..." : "清理"}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between p-5 border-b border-[var(--GlassBorder)]">
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-medium text-[var(--TextHighlight)] flex items-center gap-2 select-none">
                  其他本地数据
                  <span className="text-[11px] text-[var(--TextMuted)] font-normal font-mono bg-[var(--GlassSurface-Elevated)] px-2 py-0.5 rounded-lg">
                    AppLocalData
                  </span>
                </span>
                <span className="text-[12px] text-[var(--TextMuted)]">
                  不属于配置、工作区与恢复快照的应用本地文件。不会触碰编辑器恢复数据。
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[13px] font-mono text-[var(--TextHighlight)] select-none">
                  {otherDataSize}
                </span>
                <Button
                  variant="danger"
                  className="h-8 text-[12px] px-3.5"
                  disabled={isClearing !== null || rawOtherDataSize === 0}
                  onClick={handleClearOtherAppData}
                >
                  {isClearing === "other" ? "正在清理..." : "清理"}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between p-5">
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-medium text-[var(--TextHighlight)] flex items-center gap-2 select-none">
                  系统运行日志
                  <span className="text-[11px] text-[var(--TextMuted)] font-normal font-mono bg-[var(--GlassSurface-Elevated)] px-2 py-0.5 rounded-lg">
                    *.log
                  </span>
                </span>
                <span className="text-[12px] text-[var(--TextMuted)]">
                  记录应用生命周期、Tauri 进程及终端控制台诊断的运行日志
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[13px] font-mono text-[var(--TextHighlight)] select-none">
                  {logSize}
                </span>
                <Button
                  variant="danger"
                  className="h-8 text-[12px] px-3.5"
                  disabled={isClearing !== null || logSize === "0 B"}
                  onClick={handleClearLogs}
                >
                  {isClearing === "logs" ? "正在清理..." : "清理"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAdvanced = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">高级设置</h3>
        <p className="text-[13px] text-[var(--TextMuted)]">进行系统偏好与出厂状态重置操作</p>
      </div>

      <div className="glass-inner-card rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--GlassBorder)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">检查更新</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              手动检查 GitHub Release 中是否有可安装的新版本
            </span>
          </div>
          <Button
            variant="secondary"
            className="h-8 text-[12px] px-3.5"
            disabled={isCheckingUpdate}
            onClick={() => {
              setIsCheckingUpdate(true);
              void UpdaterService.checkForUpdates()
                .then((result) => {
                  if (result.status === "up-to-date") {
                    showToast("当前已是最新版本", "success");
                  } else if (result.status === "error") {
                    showToast(`检查更新失败：${result.error}`, "error");
                  }
                })
                .finally(() => setIsCheckingUpdate(false));
            }}
          >
            {isCheckingUpdate ? "正在检查..." : "检查更新"}
          </Button>
        </div>
        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">初始化重置</span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              清除应用全部本地数据，使编辑器回到初始安装状态
            </span>
          </div>
          <Button
            variant="danger"
            className="h-8 text-[12px] px-3.5"
            onClick={() => {
              desktopFileSystem
                .remove("user-config.json", { baseDir: BaseDirectory.AppLocalData })
                .catch(() => {});
              desktopFileSystem
                .remove("workspace.json", { baseDir: BaseDirectory.AppLocalData })
                .catch(() => {});
              localStorage.clear();
              showToast("缓存与配置已清理，请重启应用");
            }}
          >
            重置应用程序
          </Button>
        </div>
      </div>
    </div>
  );

  const sidebarMenu = (
    <div className="flex flex-col gap-1.5 w-full pr-3 pl-1">
      <h2 className="text-[11px] font-bold text-[var(--TextMuted)] uppercase tracking-widest mb-6 px-4 mt-2">
        设置中心
      </h2>

      <button
        type="button"
        onClick={() => setActiveSection("appearance")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "appearance" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.Palette size={16} /> 外观
      </button>

      <button
        type="button"
        onClick={() => setActiveSection("editor")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "editor" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.FileCode size={16} /> 编辑器
      </button>

      <button
        type="button"
        onClick={() => setActiveSection("terminal")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "terminal" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.Terminal size={16} /> 终端
      </button>

      <button
        type="button"
        onClick={() => setActiveSection("git")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "git" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.Git size={16} /> 版本控制
      </button>

      <button
        type="button"
        onClick={() => setActiveSection("storage")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "storage" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.Database size={16} /> 存储管理
      </button>

      <button
        type="button"
        onClick={() => setActiveSection("advanced")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "advanced" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.Settings size={16} /> 高级
      </button>
    </div>
  );

  const getTitle = () => {
    switch (activeSection) {
      case "appearance":
        return "外观";
      case "editor":
        return "编辑器";
      case "terminal":
        return "终端";
      case "git":
        return "版本控制";
      case "storage":
        return "存储管理";
      case "advanced":
        return "高级设置";
      default:
        return "设置";
    }
  };

  return (
    <InternalPageLayout title={getTitle()} sidebar={sidebarMenu} maxWidth="max-w-4xl">
      {activeSection === "appearance" && renderAppearance()}
      {activeSection === "editor" && renderEditor()}
      {activeSection === "terminal" && renderTerminal()}
      {activeSection === "git" && renderGit()}
      {activeSection === "storage" && renderStorage()}
      {activeSection === "advanced" && renderAdvanced()}
    </InternalPageLayout>
  );
}
