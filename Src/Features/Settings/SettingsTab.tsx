import { useEffect, useState } from "react";
import { applyAccentTheme, applyLiquidTexture } from "../../App/ThemeAccent";
import { UpdaterService } from "../../Core/UpdaterService";
import { BaseDirectory, desktopFileSystem } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { GitIPC } from "../../Foundation/IPC/GitCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import type { AccentThemeId } from "../../Foundation/Types/Config";
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { SettingsNavItem } from "../../UI/Components/SettingsNavItem";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer, useGlassStore } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { AccountSettings } from "./AccountSettings";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { DebugSettings } from "./DebugSettings";
import { LanguageServiceSettings } from "./LanguageServiceSettings";
import { StorageSettingsSection } from "./StorageSettingsSection";

export type SettingsSection =
  | "account"
  | "appearance"
  | "editor"
  | "language"
  | "debug"
  | "terminal"
  | "git"
  | "storage"
  | "advanced";

export function SettingsTab() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("account");
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
  const [liquidTexture, setLiquidTexture] = useState(false);

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
      setAccentTheme(savedAccent);
      applyAccentTheme(savedAccent);
      const savedLiquidTexture = config.liquidTexture ?? false;
      setLiquidTexture(savedLiquidTexture);
      applyLiquidTexture(savedLiquidTexture);

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
    applyAccentTheme(nextAccent);
    void UserConfigStore.set({ accentTheme: nextAccent });
  };

  const handleLiquidTextureChange = (enabled: boolean) => {
    setLiquidTexture(enabled);
    applyLiquidTexture(enabled);
    void UserConfigStore.set({ liquidTexture: enabled });
  };

  const [repoPath, setRepoPath] = useState<string | null>(
    WorkspaceStore.getCached()?.lastOpenedPath || null,
  );
  const [remoteUrl, setRemoteUrl] = useState("");
  const [isSavingGit, setIsSavingGit] = useState(false);
  const [_isGitLoading, setIsGitLoading] = useState(true);

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
    <AppearanceSettingsSection
      theme={theme}
      accentTheme={accentTheme}
      intensity={intensity}
      liquidTexture={liquidTexture}
      onThemeChange={handleThemeChange}
      onAccentThemeChange={handleAccentThemeChange}
      onIntensityChange={(value) => setIntensity(value)}
      onLiquidTextureChange={handleLiquidTextureChange}
    />
  );

  const renderEditor = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">编辑器设置</h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">配置代码编辑器的外观和行为</p>
      </div>

      <GlassContainer layer="elevated" className="rounded-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              字体大小
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              控制编辑器的主代码字体大小
            </span>
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

        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">行高</span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
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

        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              Tab 宽度
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
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

        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              自动换行
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
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
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              代码缩略图
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              当前轻量编辑器内核暂不支持缩略图；该选项将在完整实现后再开放
            </span>
          </div>
          <span className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-[12px] text-[var(--color-text-muted)]">
            暂不可用
          </span>
        </div>
      </GlassContainer>
    </div>
  );

  const renderTerminal = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">终端设置</h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">自定义集成终端的显示效果</p>
      </div>

      <GlassContainer layer="elevated" className="rounded-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              字体大小
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              控制终端控制台的字体大小
            </span>
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
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              光标闪烁
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
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
      </GlassContainer>
    </div>
  );

  const renderGit = () => (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">远程仓库配置</h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          配置当前工作区 Git 仓库的远程拉取和推送地址及凭据
        </p>
      </div>

      {!repoPath ? (
        <GlassContainer
          layer="elevated"
          className="mt-2 flex max-w-md flex-col items-center justify-center gap-4 rounded-2xl p-6 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
            <Icons.Git size={22} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-[14px] font-bold text-[var(--color-text-highlight)]">
              未检测到 Git 工作区
            </h4>
            <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              当前未在工作区打开任何有效的目录。请先在资源管理器中打开包含 Git
              仓库的文件夹，然后在此处配置凭据。
            </p>
          </div>
        </GlassContainer>
      ) : (
        <GlassContainer
          layer="elevated"
          className="mt-2 flex max-w-3xl flex-col overflow-hidden rounded-2xl"
        >
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
              <Icons.Git size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                当前工作区仓库
              </div>
              <div className="truncate text-[11px] text-[var(--color-text-muted)]">{repoPath}</div>
            </div>
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--material-interactive-hover)] px-2.5 py-1 text-[10px] font-medium text-[var(--color-text-muted)]">
              本地配置
            </span>
          </div>

          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                    远程仓库地址
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    用于当前仓库的拉取与推送
                  </span>
                </div>
                <Icons.Github size={18} className="shrink-0 text-[var(--color-text-muted)]" />
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--material-panel)] p-1 focus-within:border-[var(--color-text-muted)]/25 focus-within:ring-2 focus-within:ring-[var(--color-text-muted)]/20">
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

            <div className="flex items-start gap-3 px-3 py-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
              <Icons.Info size={16} className="mt-0.5 shrink-0" />
              <span>
                凭据由 Git Credential Manager、系统钥匙串或 SSH 密钥管理。Aurona Code
                不会将用户名、密码或 Token 写入远程地址。
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-5 py-4">
            <span className="text-[12px] text-[var(--color-text-muted)]">
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
        </GlassContainer>
      )}
    </div>
  );

  const renderStorage = () => <StorageSettingsSection />;

  const renderAdvanced = () => (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">高级设置</h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">进行系统偏好与出厂状态重置操作</p>
      </div>

      <GlassContainer layer="elevated" className="rounded-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              检查更新
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
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
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              初始化重置
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
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
      </GlassContainer>
    </div>
  );

  const sidebarMenu = (
    <div className="flex w-full flex-col gap-1.5 pl-1 pr-3">
      <h2 className="mb-6 mt-2 px-4 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
        设置中心
      </h2>

      <SettingsNavItem
        label="账户"
        icon={<Icons.User size={16} />}
        active={activeSection === "account"}
        onClick={() => setActiveSection("account")}
      />

      <SettingsNavItem
        label="外观"
        icon={<Icons.Palette size={16} />}
        active={activeSection === "appearance"}
        onClick={() => setActiveSection("appearance")}
      />

      <SettingsNavItem
        label="编辑器"
        icon={<Icons.FileCode size={16} />}
        active={activeSection === "editor"}
        onClick={() => setActiveSection("editor")}
      />

      <SettingsNavItem
        label="语言服务"
        icon={<Icons.Sparkles size={16} />}
        active={activeSection === "language"}
        onClick={() => setActiveSection("language")}
      />

      <SettingsNavItem
        label="运行和调试"
        icon={<Icons.Debug size={16} />}
        active={activeSection === "debug"}
        onClick={() => setActiveSection("debug")}
      />

      <SettingsNavItem
        label="终端"
        icon={<Icons.Terminal size={16} />}
        active={activeSection === "terminal"}
        onClick={() => setActiveSection("terminal")}
      />

      <SettingsNavItem
        label="版本控制"
        icon={<Icons.Git size={16} />}
        active={activeSection === "git"}
        onClick={() => setActiveSection("git")}
      />

      <SettingsNavItem
        label="存储管理"
        icon={<Icons.Database size={16} />}
        active={activeSection === "storage"}
        onClick={() => setActiveSection("storage")}
      />

      <SettingsNavItem
        label="高级"
        icon={<Icons.Settings size={16} />}
        active={activeSection === "advanced"}
        onClick={() => setActiveSection("advanced")}
      />
    </div>
  );

  const getTitle = () => {
    switch (activeSection) {
      case "account":
        return "账户";
      case "appearance":
        return "外观";
      case "editor":
        return "编辑器";
      case "language":
        return "语言服务";
      case "debug":
        return "运行和调试";
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
      {activeSection === "account" && <AccountSettings />}
      {activeSection === "appearance" && renderAppearance()}
      {activeSection === "editor" && renderEditor()}
      {activeSection === "language" && <LanguageServiceSettings />}
      {activeSection === "debug" && <DebugSettings />}
      {activeSection === "terminal" && renderTerminal()}
      {activeSection === "git" && renderGit()}
      {activeSection === "storage" && renderStorage()}
      {activeSection === "advanced" && renderAdvanced()}
    </InternalPageLayout>
  );
}
