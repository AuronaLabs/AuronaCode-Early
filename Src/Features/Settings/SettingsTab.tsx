import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from '../../UI/Layouts/InternalPageLayout';
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { Switch } from "../../UI/Components/Switch";
import { StorageManager } from "../../Core/StorageManager";
import { showToast } from "../../UI/Feedback/Toast";
import { EventBus } from "../../Core/EventBus";
import { GitIPC } from "../../Foundation/IPC/GitCommands";

export type SettingsSection = "appearance" | "editor" | "terminal" | "git" | "advanced";

export function SettingsTab() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");

  useEffect(() => {
    const unsub = EventBus.on("settings:nav", (section: SettingsSection) => {
      setActiveSection(section);
    });
    return () => unsub();
  }, []);

  // --- Appearance State ---
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");

  // --- Editor State ---
  const [editorFontSize, setEditorFontSize] = useState("14");
  const [editorWordWrap, setEditorWordWrap] = useState("on");
  const [editorMinimap, setEditorMinimap] = useState("true");

  // --- Terminal State ---
  const [terminalFontSize, setTerminalFontSize] = useState("13");
  const [terminalCursorBlink, setTerminalCursorBlink] = useState("true");

  useEffect(() => {
    const savedTheme = localStorage.getItem("aurona-theme") as "light" | "dark" | "system" | null;
    if (savedTheme) setTheme(savedTheme);
    
    const savedEditorFont = localStorage.getItem("aurona-editor-fontsize") || "14";
    const savedTerminalFont = localStorage.getItem("aurona-terminal-fontsize") || "13";
    setEditorFontSize(savedEditorFont);
    setEditorWordWrap(localStorage.getItem("aurona-editor-wordwrap") || "on");
    setEditorMinimap(localStorage.getItem("aurona-editor-minimap") || "true");
    
    setTerminalFontSize(savedTerminalFont);
    setTerminalCursorBlink(localStorage.getItem("aurona-terminal-cursorblink") || "true");

    // Apply CSS variables
    document.documentElement.style.setProperty("--EditorFontSize", `${savedEditorFont}px`);
    document.documentElement.style.setProperty("--TerminalFontSize", `${savedTerminalFont}px`);
  }, []);

  const handleThemeChange = (newTheme: "light" | "dark" | "system") => {
    setTheme(newTheme);
    localStorage.setItem("aurona-theme", newTheme);
    const isDark = newTheme === "dark" || (newTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  // --- Git State ---
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [isSavingGit, setIsSavingGit] = useState(false);

  useEffect(() => {
    if (activeSection !== "git") return;
    const loadGitConfig = async () => {
      await StorageManager.init();
      const config = await StorageManager.getConfig();
      if (config.lastOpenedPath) {
        setRepoPath(config.lastOpenedPath);
        try {
          const url = await GitIPC.getRemote(config.lastOpenedPath);
          if (url) {
            try {
              const urlObj = new URL(url);
              if (urlObj.username) setUsername(decodeURIComponent(urlObj.username));
              if (urlObj.password) setToken(decodeURIComponent(urlObj.password));
              urlObj.username = '';
              urlObj.password = '';
              setRemoteUrl(urlObj.toString());
            } catch {
              setRemoteUrl(url);
            }
          }
        } catch (e) {
          console.error(e);
        }
      }
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

  // --- Render ---
  const renderAppearance = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold text-[var(--ColorTextHighlight)]">色彩主题</h3>
        <p className="text-[13px] text-[var(--ColorMuted)] mb-1">选择浅色或深色界面，或者让应用跟随您的操作系统同步改变外观</p>
        <div className="flex bg-black/5 dark:bg-white/5 p-1 rounded-full w-fit mt-2">
          {(['system', 'light', 'dark'] as const).map(t => (
            <button
              key={t}
              onClick={() => handleThemeChange(t)}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-[13px] font-medium transition-colors duration-200 ${
                theme === t 
                  ? "bg-[var(--ColorPillSelected)] text-[var(--ColorPillText)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]" 
                  : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)]"
              }`}
            >
              {t === 'system' && <><Icons.Monitor size={14}/>跟随系统</>}
              {t === 'light' && <><Icons.Sun size={14}/>浅色</>}
              {t === 'dark' && <><Icons.Moon size={14}/>深色</>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderEditor = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold text-[var(--ColorTextHighlight)]">编辑器设置</h3>
        <p className="text-[13px] text-[var(--ColorMuted)] mb-2">配置代码编辑器的外观和行为</p>
        
        <div className="flex items-center justify-between py-4 group">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-[var(--ColorTextHighlight)]">字体大小</span>
            <span className="text-[12px] text-[var(--ColorMuted)]">控制编辑器的主代码字体大小</span>
          </div>
          <Select 
            value={editorFontSize}
            onChange={(val) => {
              setEditorFontSize(val);
              localStorage.setItem("aurona-editor-fontsize", val);
              document.documentElement.style.setProperty("--EditorFontSize", `${val}px`);
              EventBus.emit("settings:editor-changed");
            }}
            options={[12, 13, 14, 15, 16, 18, 20].map(size => ({ value: size.toString(), label: `${size}px` }))}
          />
        </div>

        <div className="flex items-center justify-between py-4 group">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-[var(--ColorTextHighlight)]">自动换行</span>
            <span className="text-[12px] text-[var(--ColorMuted)]">当代码超出一行长度时自动折行显示</span>
          </div>
          <Switch
            checked={editorWordWrap === "on"}
            onChange={(checked) => {
              const val = checked ? "on" : "off";
              setEditorWordWrap(val);
              localStorage.setItem("aurona-editor-wordwrap", val);
              EventBus.emit("settings:editor-changed");
            }}
          />
        </div>

        <div className="flex items-center justify-between py-4 group">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-[var(--ColorTextHighlight)]">代码缩略图</span>
            <span className="text-[12px] text-[var(--ColorMuted)]">在右侧显示代码文件的全局缩略图</span>
          </div>
          <Switch
            checked={editorMinimap === "true"}
            onChange={(checked) => {
              const val = checked ? "true" : "false";
              setEditorMinimap(val);
              localStorage.setItem("aurona-editor-minimap", val);
              EventBus.emit("settings:editor-changed");
            }}
          />
        </div>

      </div>
    </div>
  );

  const renderTerminal = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold text-[var(--ColorTextHighlight)]">终端设置</h3>
        <p className="text-[13px] text-[var(--ColorMuted)] mb-2">自定义集成终端的显示效果</p>
        
        <div className="flex items-center justify-between py-4 group">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-[var(--ColorTextHighlight)]">字体大小</span>
            <span className="text-[12px] text-[var(--ColorMuted)]">控制终端控制台的字体大小</span>
          </div>
          <Select 
            value={terminalFontSize}
            onChange={(val) => {
              setTerminalFontSize(val);
              localStorage.setItem("aurona-terminal-fontsize", val);
              document.documentElement.style.setProperty("--TerminalFontSize", `${val}px`);
              EventBus.emit("settings:terminal-changed");
            }}
            options={[12, 13, 14, 15, 16, 18, 20].map(size => ({ value: size.toString(), label: `${size}px` }))}
          />
        </div>

        <div className="flex items-center justify-between py-4 group">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-[var(--ColorTextHighlight)]">光标闪烁</span>
            <span className="text-[12px] text-[var(--ColorMuted)]">是否开启终端光标的呼吸闪烁效果</span>
          </div>
          <Switch
            checked={terminalCursorBlink === "true"}
            onChange={(checked) => {
              const val = checked ? "true" : "false";
              setTerminalCursorBlink(val);
              localStorage.setItem("aurona-terminal-cursorblink", val);
              EventBus.emit("settings:terminal-changed");
            }}
          />
        </div>

      </div>
    </div>
  );

  const renderGit = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold text-[var(--ColorTextHighlight)]">远程仓库配置</h3>
        <p className="text-[13px] text-[var(--ColorMuted)]">配置当前工作区 Git 仓库的远程拉取和推送地址及凭据</p>
        
        {!repoPath ? (
          <div className="p-4 bg-yellow-500/10 text-yellow-600 rounded-2xl text-[13px]">
            当前未在工作区打开任何目录，请先打开一个包含 Git 仓库的文件夹
          </div>
        ) : (
          <div className="space-y-6 mt-2 max-w-xl">
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-medium text-[var(--ColorTextHighlight)]">Remote URL</label>
              <Input value={remoteUrl} onChange={e => setRemoteUrl(e.target.value)} placeholder="https://github.com/..." />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-[13px] font-medium text-[var(--ColorTextHighlight)]">用户名 (可选)</label>
                <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="Git 用户名" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[13px] font-medium text-[var(--ColorTextHighlight)]">访问令牌</label>
                <Input value={token} type="password" onChange={e => setToken(e.target.value)} placeholder="Token 或 密码" />
              </div>
            </div>

            <div className="pt-2">
              <Button variant="primary" onClick={handleSaveGit} disabled={isSavingGit || !remoteUrl.trim()}>
                {isSavingGit ? "正在应用..." : "应用更改"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderAdvanced = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold text-[var(--ColorTextHighlight)]">缓存与重置</h3>
        <p className="text-[13px] text-[var(--ColorMuted)] mb-2">清除应用全部本地缓存数据，包括最近打开的文件夹记录、界面布局状态等，这会让编辑器回到初始状态</p>
        <Button variant="danger" className="w-fit" onClick={() => { localStorage.clear(); showToast("缓存已清理，请重启应用"); }}>
          清除本地缓存
        </Button>
      </div>
    </div>
  );

  const sidebarMenu = (
    <div className="flex flex-col gap-1 w-full pl-2">
      <h2 className="text-[11px] font-bold text-[var(--ColorMuted)] uppercase tracking-widest mb-6 px-4 mt-2">
        设置中心
      </h2>
      
      <button 
        onClick={() => setActiveSection("appearance")}
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-medium transition-colors ${activeSection === "appearance" ? "bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/5"}`}
      >
        <Icons.Palette size={16} /> 外观
      </button>

      <button 
        onClick={() => setActiveSection("editor")}
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-medium transition-colors ${activeSection === "editor" ? "bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/5"}`}
      >
        <Icons.FileCode size={16} /> 编辑器
      </button>

      <button 
        onClick={() => setActiveSection("terminal")}
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-medium transition-colors ${activeSection === "terminal" ? "bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/5"}`}
      >
        <Icons.Terminal size={16} /> 终端
      </button>

      <button 
        onClick={() => setActiveSection("git")}
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-medium transition-colors ${activeSection === "git" ? "bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/5"}`}
      >
        <Icons.Git size={16} /> 版本控制
      </button>

      <button 
        onClick={() => setActiveSection("advanced")}
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-medium transition-colors ${activeSection === "advanced" ? "bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/5"}`}
      >
        <Icons.Settings size={16} /> 高级
      </button>
    </div>
  );

  const getTitle = () => {
    switch (activeSection) {
      case "appearance": return "外观";
      case "editor": return "编辑器";
      case "terminal": return "终端";
      case "git": return "版本控制";
      case "advanced": return "高级设置";
      default: return "设置";
    }
  };

  return (
    <InternalPageLayout 
      title={getTitle()}
      sidebar={sidebarMenu}
    >
      {activeSection === "appearance" && renderAppearance()}
      {activeSection === "editor" && renderEditor()}
      {activeSection === "terminal" && renderTerminal()}
      {activeSection === "git" && renderGit()}
      {activeSection === "advanced" && renderAdvanced()}
    </InternalPageLayout>
  );
}
