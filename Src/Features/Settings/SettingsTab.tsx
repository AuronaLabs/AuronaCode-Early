import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from '../../UI/Layouts/InternalPageLayout';
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { StorageManager } from "../../Core/StorageManager";
import { showToast } from "../../UI/Feedback/Toast";
import { EventBus } from "../../Core/EventBus";

export type SettingsSection = "appearance" | "git" | "advanced";

export function SettingsTab() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");

  useEffect(() => {
    // Allows other components to direct the settings tab to a specific section
    const unsub = EventBus.on("settings:nav", (section: SettingsSection) => {
      setActiveSection(section);
    });
    return () => unsub();
  }, []);

  // --- Appearance State ---
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");

  useEffect(() => {
    const savedTheme = localStorage.getItem("aurona-theme") as "light" | "dark" | "system" | null;
    if (savedTheme) {
      setTheme(savedTheme);
    }
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
          const url = await invoke<string>("git_get_remote", { path: config.lastOpenedPath });
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
      await invoke("git_set_remote", { path: repoPath, url: finalUrl });
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
        <div className="flex bg-black/[0.03] dark:bg-white/[0.03] p-1 rounded-lg border border-[var(--ColorPanelBorder)] w-fit">
          {(['system', 'light', 'dark'] as const).map(t => (
            <button
              key={t}
              onClick={() => handleThemeChange(t)}
              className={`flex items-center gap-2 px-5 py-2 rounded-md text-[13px] font-medium transition-all ${
                theme === t 
                  ? "bg-[var(--ColorEditor)] text-[var(--ColorTextHighlight)] shadow-sm border border-[var(--ColorPanelBorder)]" 
                  : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] border border-transparent"
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

  const renderGit = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold text-[var(--ColorTextHighlight)]">远程仓库配置 (Remote Origin)</h3>
        <p className="text-[13px] text-[var(--ColorMuted)]">配置当前工作区 Git 仓库的远程拉取和推送地址及凭据</p>
        
        {!repoPath ? (
          <div className="p-4 bg-yellow-500/10 text-yellow-600 rounded-lg text-[13px] border border-yellow-500/20">
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
                <label className="text-[13px] font-medium text-[var(--ColorTextHighlight)]">访问令牌 (Token)</label>
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
    <div className="flex flex-col gap-1 w-full">
      <h2 className="text-[11px] font-bold text-[var(--ColorMuted)] uppercase tracking-widest mb-4 px-3 mt-1">
        设置中心
      </h2>
      
      <button 
        onClick={() => setActiveSection("appearance")}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${activeSection === "appearance" ? "bg-[var(--ColorTextHighlight)] text-[var(--ColorApp)] shadow-sm" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/5"}`}
      >
        <Icons.Palette size={16} /> 外观
      </button>

      <button 
        onClick={() => setActiveSection("git")}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${activeSection === "git" ? "bg-[var(--ColorTextHighlight)] text-[var(--ColorApp)] shadow-sm" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/5"}`}
      >
        <Icons.Git size={16} /> 版本控制
      </button>

      <button 
        onClick={() => setActiveSection("advanced")}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${activeSection === "advanced" ? "bg-[var(--ColorTextHighlight)] text-[var(--ColorApp)] shadow-sm" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/5"}`}
      >
        <Icons.Settings size={16} /> 高级
      </button>
    </div>
  );

  const getTitle = () => {
    switch (activeSection) {
      case "appearance": return "外观 (Appearance)";
      case "git": return "版本控制 (Git)";
      case "advanced": return "高级设置 (Advanced)";
      default: return "设置";
    }
  };

  return (
    <InternalPageLayout 
      title={getTitle()}
      sidebar={sidebarMenu}
    >
      {activeSection === "appearance" && renderAppearance()}
      {activeSection === "git" && renderGit()}
      {activeSection === "advanced" && renderAdvanced()}
    </InternalPageLayout>
  );
}
