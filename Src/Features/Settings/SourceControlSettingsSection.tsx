import { useEffect, useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import { GitIPC } from "../../Foundation/IPC/GitCommands";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";

export function SourceControlSettingsSection() {
  const { t } = useLocale();
  const [repoPath, setRepoPath] = useState<string | null>(
    WorkspaceStore.getCached()?.lastOpenedPath || null,
  );
  const [remoteUrl, setRemoteUrl] = useState("");
  const [isSavingGit, setIsSavingGit] = useState(false);

  useEffect(() => {
    const loadGitConfig = async () => {
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
        showToast(t("settings.toast.noGitWorkspace"), "warning");
      }
    };
    void loadGitConfig();
  }, [t]);

  const handleSaveGit = async () => {
    if (!repoPath || !remoteUrl.trim()) {
      showToast(t("settings.toast.enterRemoteUrl"), "error");
      return;
    }
    setIsSavingGit(true);
    try {
      const finalUrl = remoteUrl.trim();
      try {
        const urlObj = new URL(finalUrl);
        if (urlObj.username || urlObj.password) {
          showToast(t("settings.toast.credentialWarning"), "error");
          return;
        }
      } catch {
        // SSH remote URLs are valid Git remote URLs without exposing plaintext credentials.
      }
      await GitIPC.setRemote(repoPath, finalUrl);
      showToast(t("settings.toast.remoteUpdated"), "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("settings.toast.saveFailed").replace("{message}", message), "error");
    } finally {
      setIsSavingGit(false);
    }
  };

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.sourceControl")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.sourceControlDescription")}
        </p>
      </div>

      {!repoPath ? (
        <GlassContainer
          layer="raised"
          className="mt-2 flex max-w-md flex-col items-center justify-center gap-4 p-6 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-surface)] border border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
            <Icons.Git size={22} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-[14px] font-bold text-[var(--color-text-highlight)]">
              {t("settings.sourceControlSection.noRepo")}
            </h4>
            <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              {t("settings.sourceControlSection.noRepoDescription")}
            </p>
          </div>
        </GlassContainer>
      ) : (
        <GlassContainer layer="raised" className="mt-2 flex max-w-3xl flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
              <Icons.Git size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                {t("settings.sourceControlSection.currentRepo")}
              </div>
              <div className="truncate text-[11px] text-[var(--color-text-muted)]">{repoPath}</div>
            </div>
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--material-interactive-hover)] px-2.5 py-1 text-[10px] font-medium text-[var(--color-text-muted)]">
              {t("settings.sourceControlSection.localConfig")}
            </span>
          </div>

          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                    {t("settings.sourceControlSection.remoteUrl")}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {t("settings.sourceControlSection.remoteUrlDescription")}
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
              <span>{t("settings.sourceControlSection.credentialsNote")}</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-5 py-4">
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("settings.sourceControlSection.localOnly")}
            </span>
            <Button
              variant="glass"
              onClick={handleSaveGit}
              disabled={isSavingGit || !remoteUrl.trim()}
            >
              <Icons.Save size={14} />
              {isSavingGit
                ? t("settings.sourceControlSection.applying")
                : t("settings.sourceControlSection.apply")}
            </Button>
          </div>
        </GlassContainer>
      )}
    </div>
  );
}
