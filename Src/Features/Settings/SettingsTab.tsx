import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, remove, stat } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";
import { EventBus } from "../../Foundation/EventBus";
import { GitIPC } from "../../Foundation/IPC/GitCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { Switch } from "../../UI/Components/Switch";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { useGlassStore, type GlassIntensity } from "../../UI/Core/GlassManager";

export type SettingsSection = "appearance" | "editor" | "terminal" | "git" | "storage" | "advanced";

export function SettingsTab() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");
  const { intensity, setIntensity } = useGlassStore();

  useEffect(() => {
    const unsub = EventBus.on("settings:nav", (section: SettingsSection) => {
      setActiveSection(section);
    });
    return () => unsub();
  }, []);

  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");

  const [editorFontSize, setEditorFontSize] = useState("14");
  const [editorWordWrap, setEditorWordWrap] = useState("on");
  const [editorMinimap, setEditorMinimap] = useState("true");

  const [terminalFontSize, setTerminalFontSize] = useState("13");
  const [terminalCursorBlink, setTerminalCursorBlink] = useState("true");

  useEffect(() => {
    UserConfigStore.get().then((config) => {
      const savedTheme = config.theme as "light" | "dark" | "system" | undefined;
      if (savedTheme) setTheme(savedTheme);

      const savedEditorFont = config.editorFontSize?.toString() || "14";
      const savedTerminalFont = config.terminalFontSize?.toString() || "13";
      setEditorFontSize(savedEditorFont);
      setEditorWordWrap(config.editorWordWrap || "on");
      setEditorMinimap(config.editorMinimap !== false ? "true" : "false");

      setTerminalFontSize(savedTerminalFont);
      setTerminalCursorBlink(config.terminalCursorBlink !== false ? "true" : "false");

      document.documentElement.style.setProperty("--EditorFontSize", `${savedEditorFont}px`);
      document.documentElement.style.setProperty("--TerminalFontSize", `${savedTerminalFont}px`);
    });
  }, []);

  const handleThemeChange = (newTheme: "light" | "dark" | "system") => {
    setTheme(newTheme);
    UserConfigStore.set({ theme: newTheme });
    const isDark =
      newTheme === "dark" ||
      (newTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    document.documentElement.classList.add("theme-transitioning");
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    setTimeout(() => {
      document.documentElement.classList.remove("theme-transitioning");
    }, 300);
  };

  const [repoPath, setRepoPath] = useState<string | null>(
    WorkspaceStore.getCached()?.lastOpenedPath || null,
  );
  const [remoteUrl, setRemoteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [isSavingGit, setIsSavingGit] = useState(false);
  const [isGitLoading, setIsGitLoading] = useState(true);

  const [configSize, setConfigSize] = useState("0 B");
  const [workspaceSize, setWorkspaceSize] = useState("0 B");
  const [otherDataSize, setOtherDataSize] = useState("0 B");
  const [appDataSize, setAppDataSize] = useState("0 B");
  const [logSize, setLogSize] = useState("0 B");
  const [rawConfigSize, setRawConfigSize] = useState(0);
  const [rawWorkspaceSize, setRawWorkspaceSize] = useState(0);
  const [rawOtherDataSize, setRawOtherDataSize] = useState(0);
  const [rawAppDataSize, setRawAppDataSize] = useState(0);
  const [rawLogSize, setRawLogSize] = useState(0);
  const [isClearing, setIsClearing] = useState<string | null>(null);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / k ** i).toFixed(1)) + " " + sizes[i];
  };

  const loadStorageSizes = async () => {
    let cSize = 0;
    let wSize = 0;
    try {
      const configStat = await stat("user-config.json", { baseDir: BaseDirectory.AppLocalData });
      cSize = configStat.size;
    } catch {}
    setConfigSize(formatBytes(cSize));
    setRawConfigSize(cSize);

    try {
      const workspaceStat = await stat("workspace.json", { baseDir: BaseDirectory.AppLocalData });
      wSize = workspaceStat.size;
    } catch {}
    setWorkspaceSize(formatBytes(wSize));
    setRawWorkspaceSize(wSize);

    try {
      const dataSize: number = await invoke("get_app_data_size");
      setAppDataSize(formatBytes(dataSize));
      setRawAppDataSize(dataSize);

      const other = Math.max(0, dataSize - cSize - wSize);
      setOtherDataSize(formatBytes(other));
      setRawOtherDataSize(other);
    } catch {
      setAppDataSize("0 B");
      setRawAppDataSize(0);
      setOtherDataSize("0 B");
      setRawOtherDataSize(0);
    }
    try {
      const lSize: number = await invoke("get_app_log_size");
      setLogSize(formatBytes(lSize));
      setRawLogSize(lSize);
    } catch {
      setLogSize("0 B");
      setRawLogSize(0);
    }
  };

  useEffect(() => {
    if (activeSection === "storage") {
      loadStorageSizes();
    }
  }, [activeSection]);

  const handleClearConfig = async () => {
    setIsClearing("config");
    try {
      await remove("user-config.json", { baseDir: BaseDirectory.AppLocalData });
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
      await remove("workspace.json", { baseDir: BaseDirectory.AppLocalData });
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
      await invoke("clear_other_app_data");
      showToast("已清理其他缓存数据与碎片，部分可能需重启后释放", "success");
      loadStorageSizes();
    } catch (e) {
      showToast(`清除时发生错误: ${e}`, "warning");
      loadStorageSizes(); // Still reload because some files might have been deleted
    } finally {
      setIsClearing(null);
    }
  };

  const handleClearLogs = async () => {
    setIsClearing("logs");
    try {
      await remove("app.log", { baseDir: BaseDirectory.AppLog });
      setLogSize("0 B");
      setRawLogSize(0);
      showToast("运行日志已清理完毕", "success");
    } catch (e) {
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
              if (urlObj.username) setUsername(decodeURIComponent(urlObj.username));
              if (urlObj.password) setToken(decodeURIComponent(urlObj.password));
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
      let finalUrl = remoteUrl.trim();
      if (username.trim() && token.trim()) {
        try {
          const urlObj = new URL(finalUrl);
          urlObj.username = encodeURIComponent(username.trim());
          urlObj.password = encodeURIComponent(token.trim());
          finalUrl = urlObj.toString();
        } catch {}
      }
      await GitIPC.setRemote(repoPath, finalUrl);
      showToast("远程仓库地址已成功更新", "success");
    } catch (e: any) {
      showToast(`保存失败: ${e}`, "error");
    } finally {
      setIsSavingGit(false);
    }
  };

  const renderAppearance = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">色彩主题</h3>
        <p className="text-[13px] text-[var(--TextMuted)]">
          选择浅色或深色界面，或者让应用跟随您的操作系统同步改变外观
        </p>
      </div>

      <div className="glass-inner-card rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">外观模式</span>
            <span className="text-[12px] text-[var(--TextMuted)]">更改编辑器的整体色彩倾向</span>
          </div>
          <div className="flex bg-[var(--GlassSurface-Elevated)] p-1.5 rounded-xl gap-1">
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleThemeChange(t)}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                  theme === t
                    ? "bg-white/20 bg-[var(--GlassSurface-Elevated)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] shadow-sm scale-105"
                    : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"
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
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-6">
        <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">视觉效果</h3>
        <p className="text-[13px] text-[var(--TextMuted)]">调整界面元素的玻璃拟物（毛玻璃）效果强度</p>
      </div>

      <div className="glass-inner-card rounded-2xl overflow-hidden shadow-sm mt-2">
        <div className="flex items-center justify-between p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--TextHighlight)]">拟物强度</span>
            <span className="text-[12px] text-[var(--TextMuted)]">配置全局毛玻璃的模糊与透明度</span>
          </div>
          <Select 
            value={intensity} 
            onChange={(val: any) => setIntensity(val as GlassIntensity)}
            className="w-[140px] shrink-0"
            options={[
              { value: "disabled", label: "Disabled (性能模式)" },
              { value: "light", label: "Light (轻微)" },
              { value: "medium", label: "Medium (默认)" },
              { value: "heavy", label: "Heavy (强烈)" }
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
              在右侧显示代码文件的全局缩略图
            </span>
          </div>
          <Switch
            checked={editorMinimap === "true"}
            onCheckedChange={(checked) => {
              const val = checked ? "true" : "false";
              setEditorMinimap(val);
              UserConfigStore.set({ editorMinimap: checked });
              EventBus.emit("settings:editor-changed");
            }}
          />
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
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--TextHighlight)]">远程仓库配置</h3>
        <p className="text-[13px] text-[var(--TextMuted)]">
          配置当前工作区 Git 仓库的远程拉取和推送地址及凭据
        </p>
      </div>

      {!repoPath ? (
        <div className="glass-inner-card rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-4 max-w-md mt-2">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Icons.Git size={22} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-[14px] font-bold text-[var(--TextHighlight)]">
              未检测到 Git 工作区
            </h4>
            <p className="text-[12px] text-[var(--TextMuted)] leading-relaxed">
              当前未在工作区打开任何有效的目录。请先在资源管理器中打开包含 Git
              仓库的文件夹，然后在此处配置凭据。
            </p>
          </div>
        </div>
      ) : (
        <div className="glass-inner-card rounded-2xl overflow-hidden shadow-sm flex flex-col max-w-3xl mt-2">
          <div className="flex flex-col p-5 border-b border-[var(--GlassBorder)] gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[14px] font-medium text-[var(--TextHighlight)]">
                Remote URL
              </span>
              <span className="text-[12px] text-[var(--TextMuted)]">
                当前工作区 Git 仓库的远程推送和拉取地址
              </span>
            </div>
            <Input
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://github.com/..."
              fullWidth
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 border-b border-[var(--GlassBorder)]">
            <div className="flex flex-col p-5 border-r border-[var(--GlassBorder)] gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-medium text-[var(--TextHighlight)]">
                  用户名 (可选)
                </span>
                <span className="text-[12px] text-[var(--TextMuted)]">远程 Git 账户的用户名</span>
              </div>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Git 用户名"
                fullWidth
                className="mt-1"
              />
            </div>

            <div className="flex flex-col p-5 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-medium text-[var(--TextHighlight)]">
                  访问令牌 / 密码
                </span>
                <span className="text-[12px] text-[var(--TextMuted)]">
                  HTTPS 访问凭证 (如 Access Token)
                </span>
              </div>
              <Input
                value={token}
                type="password"
                onChange={(e) => setToken(e.target.value)}
                placeholder="Token 或 密码"
                fullWidth
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-5 bg-[var(--GlassSurface-Elevated)] dark:bg-white/2">
            <span className="text-[12px] text-[var(--TextMuted)]">
              设置仅保存在本地工作区配置中，不会向任何外部传送
            </span>
            <Button
              variant="primary"
              onClick={handleSaveGit}
              disabled={isSavingGit || !remoteUrl.trim()}
            >
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

        <div className="glass-inner-card rounded-2xl p-6 shadow-sm flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
              <span className="text-[20px] font-extrabold text-[var(--TextHighlight)] tracking-tight select-none">
                {totalSizeFormatted}{" "}
                <span className="text-[12px] font-normal text-[var(--TextMuted)] font-sans">
                  本地数据已使用
                </span>
              </span>
              <span className="text-[12px] text-[var(--TextMuted)] font-medium select-none">
                设备可用空间充足
              </span>
            </div>

            <div className="w-full h-3.5 bg-black/10 dark:bg-white/5 rounded-full overflow-hidden flex select-none">
              {totalRawSize === 0 && (
                <div className="h-full bg-black/20 bg-[var(--GlassSurface-Elevated)]" style={{ width: "100%" }} />
              )}
              {rawConfigSize > 0 && (
                <div
                  className="h-full bg-emerald-500 hover:opacity-80 transition-opacity"
                  style={{ width: `${configPct}%` }}
                  title={`配置偏好 (${configSize})`}
                />
              )}
              {rawWorkspaceSize > 0 && (
                <div
                  className="h-full bg-amber-500 hover:opacity-80 transition-opacity"
                  style={{ width: `${workspacePct}%` }}
                  title={`工作区缓存 (${workspaceSize})`}
                />
              )}
              {rawOtherDataSize > 0 && (
                <div
                  className="h-full bg-blue-500 hover:opacity-80 transition-opacity"
                  style={{ width: `${otherPct}%` }}
                  title={`其他缓存数据 (${otherDataSize})`}
                />
              )}
              {rawLogSize > 0 && (
                <div
                  className="h-full bg-purple-500 hover:opacity-80 transition-opacity"
                  style={{ width: `${logPct}%` }}
                  title={`运行日志 (${logSize})`}
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
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span>其他数据 ({otherDataSize})</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--TextMuted)]">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                <span>运行日志 ({logSize})</span>
              </div>
            </div>
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
                  WebView 缓存与杂项
                  <span className="text-[11px] text-[var(--TextMuted)] font-normal font-mono bg-[var(--GlassSurface-Elevated)] px-2 py-0.5 rounded-lg">
                    Cache / WebKit
                  </span>
                </span>
                <span className="text-[12px] text-[var(--TextMuted)]">
                  清除 Tauri 与内置网页引擎在运行期间产生的离线图片、网络请求与其他碎片文件
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
              remove("user-config.json", { baseDir: BaseDirectory.AppLocalData }).catch(() => {});
              remove("workspace.json", { baseDir: BaseDirectory.AppLocalData }).catch(() => {});
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
        onClick={() => setActiveSection("appearance")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "appearance" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.Palette size={16} /> 外观
      </button>

      <button
        onClick={() => setActiveSection("editor")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "editor" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.FileCode size={16} /> 编辑器
      </button>

      <button
        onClick={() => setActiveSection("terminal")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "terminal" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.Terminal size={16} /> 终端
      </button>

      <button
        onClick={() => setActiveSection("git")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "git" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.Git size={16} /> 版本控制
      </button>

      <button
        onClick={() => setActiveSection("storage")}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${activeSection === "storage" ? "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-[var(--GlassBorder)] text-[var(--TextHighlight)] font-semibold" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] border border-transparent"}`}
      >
        <Icons.Database size={16} /> 存储管理
      </button>

      <button
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
