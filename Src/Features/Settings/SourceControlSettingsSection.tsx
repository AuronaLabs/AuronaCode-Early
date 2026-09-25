import { useCallback, useEffect, useRef, useState } from "react";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { type GitFullStatus, GitIPC } from "../../Foundation/IPC/GitCommands";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";

function displayRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function SourceControlSettingsSection() {
  const { t } = useLocale();
  const [repoPath, setRepoPath] = useState<string | null>(
    WorkspaceStore.getCached()?.lastOpenedPath || null,
  );
  const [isRepo, setIsRepo] = useState(false);
  const [status, setStatus] = useState<GitFullStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [savedRemoteUrl, setSavedRemoteUrl] = useState("");
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingGit, setIsSavingGit] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const requestIdRef = useRef(0);
  const currentPathRef = useRef(repoPath);

  const loadRepository = useCallback(async (path: string | null) => {
    const requestId = ++requestIdRef.current;
    currentPathRef.current = path;
    setRepoPath(path);
    setIsLoading(true);
    setStatusError(null);
    setRemoteError(null);
    setStatus(null);
    setRemoteUrl("");
    setSavedRemoteUrl("");
    if (!path) {
      setIsRepo(false);
      setIsLoading(false);
      return;
    }

    try {
      const repoExists = await GitIPC.checkIsRepo(path);
      if (requestId !== requestIdRef.current) return;
      setIsRepo(repoExists);
      if (!repoExists) {
        return;
      }

      const [statusResult, remoteResult] = await Promise.allSettled([
        GitIPC.getFullStatus(path),
        GitIPC.getRemote(path),
      ]);
      if (requestId !== requestIdRef.current) return;
      if (statusResult.status === "fulfilled") {
        setStatus(statusResult.value);
      } else {
        setStatus(null);
        setStatusError(String(statusResult.reason));
      }
      if (remoteResult.status === "fulfilled") {
        const safeUrl = displayRemoteUrl(remoteResult.value);
        setRemoteUrl(safeUrl);
        setSavedRemoteUrl(safeUrl);
      } else {
        setRemoteError(String(remoteResult.reason));
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setIsRepo(false);
      setStatusError(String(error));
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let rootChanged = false;
    void WorkspaceStore.init().then(async () => {
      const config = await WorkspaceStore.get();
      if (!rootChanged) void loadRepository(config.lastOpenedPath || null);
    });
    const unsubscribe = EventBus.on("workspace:root-changed", (path: string) => {
      rootChanged = true;
      void loadRepository(path);
    });
    return () => {
      rootChanged = true;
      requestIdRef.current += 1;
      unsubscribe();
    };
  }, [loadRepository]);

  const handleSaveGit = async () => {
    if (!repoPath || !remoteUrl.trim()) {
      showToast(t("settings.toast.enterRemoteUrl"), "error");
      return;
    }
    const finalUrl = remoteUrl.trim();
    try {
      const parsed = new URL(finalUrl);
      if (parsed.username || parsed.password) {
        showToast(t("settings.toast.credentialWarning"), "error");
        return;
      }
    } catch {
      // SCP-style SSH remote URLs do not parse as standard URLs.
    }

    setIsSavingGit(true);
    try {
      await GitIPC.setRemote(repoPath, finalUrl);
      if (currentPathRef.current === repoPath) await loadRepository(repoPath);
      showToast(t("settings.toast.remoteUpdated"), "success");
    } catch (error) {
      showToast(t("settings.toast.saveFailed").replace("{message}", String(error)), "error");
    } finally {
      setIsSavingGit(false);
    }
  };

  const handleFetch = async () => {
    if (!repoPath || !savedRemoteUrl || isFetching) return;
    setIsFetching(true);
    try {
      await GitIPC.fetch(repoPath);
      if (currentPathRef.current === repoPath) await loadRepository(repoPath);
      showToast(
        t("sourceControl.repoActionCompleted").replace("{label}", t("sourceControl.fetchUpdates")),
        "success",
      );
    } catch (error) {
      showToast(
        t("sourceControl.repoActionFailed")
          .replace("{label}", t("sourceControl.fetchUpdates"))
          .replace("{message}", String(error)),
        "error",
      );
    } finally {
      setIsFetching(false);
    }
  };

  const handleInit = async () => {
    if (!repoPath || isInitializing) return;
    setIsInitializing(true);
    try {
      await GitIPC.init(repoPath);
      if (currentPathRef.current === repoPath) await loadRepository(repoPath);
    } catch (error) {
      showToast(t("sourceControl.initFailed").replace("{message}", String(error)), "error");
    } finally {
      setIsInitializing(false);
    }
  };

  const stagedCount =
    status?.files.filter((file) => file.is_staged && !file.is_conflict).length ?? 0;
  const changeCount =
    status?.files.filter((file) => !file.is_staged && !file.is_conflict).length ?? 0;
  const conflictCount = status?.files.filter((file) => file.is_conflict).length ?? 0;
  const hasUnsavedRemote = remoteUrl.trim() !== savedRemoteUrl;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.sourceControl")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.sourceControlDescription")}
        </p>
      </div>

      {repoPath && isLoading && !isRepo ? (
        <GlassContainer layer="raised" className="flex items-center gap-3 p-5">
          <Icons.Refresh size={16} className="animate-spin text-[var(--color-text-muted)]" />
          <span className="text-[12px] text-[var(--color-text-muted)]">
            {t("sourceControl.loadingStatus")}
          </span>
        </GlassContainer>
      ) : !repoPath || !isRepo ? (
        <GlassContainer
          layer="raised"
          className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center"
        >
          <div className="grid size-11 shrink-0 place-items-center rounded-surface border border-[var(--border-subtle)] bg-[var(--material-interactive-active)]">
            <Icons.Git size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
              {statusError
                ? t("sourceControl.repoCheckFailed").replace("{message}", statusError)
                : repoPath
                  ? t("sourceControl.notInitializedTitle")
                  : t("sourceControl.noWorkspaceTitle")}
            </div>
            <p className="mt-1 break-all text-[12px] leading-5 text-[var(--color-text-muted)]">
              {repoPath || t("sourceControl.noWorkspaceDescription")}
            </p>
          </div>
          {repoPath && !statusError && (
            <Button
              variant="secondary"
              className="ml-auto shrink-0"
              onClick={() => void handleInit()}
              disabled={isInitializing}
            >
              <Icons.Plus size={14} />
              {t("sourceControl.initRepository")}
            </Button>
          )}
        </GlassContainer>
      ) : (
        <>
          <GlassContainer layer="raised" className="overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4">
              <div className="grid size-9 shrink-0 place-items-center rounded-control border border-[var(--border-subtle)] bg-[var(--material-interactive-active)]">
                <Icons.Git size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                  {t("settings.sourceControlSection.currentRepo")}
                </div>
                <div className="truncate text-[11px] text-[var(--color-text-muted)]">
                  {repoPath}
                </div>
              </div>
              <div className="flex max-w-[40%] items-center gap-1.5 rounded-control border border-[var(--border-subtle)] bg-[var(--material-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]">
                <Icons.GitBranch size={13} className="shrink-0" />
                <span className="truncate">{status?.branch || t("sourceControl.noBranch")}</span>
              </div>
            </div>

            {status ? (
              <div className="grid grid-cols-2 border-t border-[var(--border-subtle)] sm:grid-cols-3">
                {[
                  { label: t("sourceControl.staged"), count: stagedCount, Icon: Icons.Checks },
                  { label: t("sourceControl.changes"), count: changeCount, Icon: Icons.FileCode },
                  {
                    label: t("sourceControl.conflicts"),
                    count: conflictCount,
                    Icon: Icons.AlertTriangle,
                  },
                ].map(({ label, count, Icon }) => (
                  <div
                    key={label}
                    className="flex min-w-0 items-center gap-2.5 border-r border-b border-[var(--border-subtle)] px-5 py-3.5 last:border-r-0 sm:border-b-0"
                  >
                    <Icon size={15} className="shrink-0 text-[var(--color-text-muted)]" />
                    <span className="min-w-0 truncate text-[12px] text-[var(--color-text-secondary)]">
                      {label}
                    </span>
                    <span className="ml-auto text-[14px] font-semibold tabular-nums text-[var(--color-text-highlight)]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-t border-[var(--border-subtle)] px-5 py-3 text-[12px] text-[var(--color-text-muted)]">
                {statusError
                  ? t("sourceControl.statusReadFailed").replace("{message}", statusError)
                  : t("sourceControl.loadingStatus")}
              </div>
            )}
            {status?.has_remote && (status.ahead > 0 || status.behind > 0) && (
              <div className="flex flex-wrap gap-4 border-t border-[var(--border-subtle)] px-5 py-3 text-[11px] text-[var(--color-text-secondary)]">
                <span>
                  {t("sourceControl.pullCount").replace("{count}", String(status.behind))}
                </span>
                <span>{t("sourceControl.pushCount").replace("{count}", String(status.ahead))}</span>
              </div>
            )}
          </GlassContainer>

          <GlassContainer layer="raised" className="overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                  {t("settings.sourceControlSection.remoteUrl")}
                </div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
                  {t("settings.sourceControlSection.remoteUrlDescription")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadRepository(repoPath)}
                disabled={isLoading || isSavingGit || isFetching || hasUnsavedRemote}
                aria-label={t("sourceControl.refresh")}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-control text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icons.Refresh size={15} className={isLoading ? "animate-spin" : ""} />
              </button>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4">
              <Input
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
                placeholder="https://github.com/..."
                aria-label={t("settings.sourceControlSection.remoteUrl")}
                disabled={isLoading || isSavingGit || isFetching}
                fullWidth
                surface="embedded"
                inputSize="lg"
              />
              {remoteError ? (
                <p role="alert" className="text-[11.5px] text-[var(--StatusError)]">
                  {t("settings.sourceControlSection.remoteReadFailed").replace(
                    "{message}",
                    remoteError,
                  )}
                </p>
              ) : !savedRemoteUrl && !isLoading ? (
                <p className="text-[11.5px] text-[var(--color-text-muted)]">
                  {t("settings.sourceControlSection.remoteMissing")}
                </p>
              ) : null}
              <p className="flex items-start gap-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
                <Icons.Info size={14} className="mt-0.5 shrink-0" />
                {t("settings.sourceControlSection.credentialsNote")}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-3.5">
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {t("settings.sourceControlSection.localOnly")}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void handleFetch()}
                  disabled={
                    isLoading || !savedRemoteUrl || hasUnsavedRemote || isFetching || isSavingGit
                  }
                >
                  <Icons.Refresh size={14} className={isFetching ? "animate-spin" : ""} />
                  {t("sourceControl.fetchUpdates")}
                </Button>
                <Button
                  variant="glass"
                  onClick={() => void handleSaveGit()}
                  disabled={isLoading || isSavingGit || !remoteUrl.trim() || !hasUnsavedRemote}
                >
                  <Icons.Save size={14} />
                  {isSavingGit
                    ? t("settings.sourceControlSection.applying")
                    : t("settings.sourceControlSection.apply")}
                </Button>
              </div>
            </div>
          </GlassContainer>
        </>
      )}
    </div>
  );
}
