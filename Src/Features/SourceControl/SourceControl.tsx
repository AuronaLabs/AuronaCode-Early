import React, { useCallback, useEffect, useRef, useState } from "react";
import { GitService, type SourceControlCache } from "../../Core/GitService";
import { OutputService } from "../../Core/OutputService";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import {
  type GitBranch,
  type GitCommit,
  type GitFile,
  GitIPC,
  type GitRecovery,
} from "../../Foundation/IPC/GitCommands";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { cn } from "../../Shared/Utils/cn";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Badge } from "../../UI/Components/Badge";
import { Button } from "../../UI/Components/Button";
import { EmptyState } from "../../UI/Components/EmptyState";
import { FilterChips } from "../../UI/Components/FilterChips";
import { glassListHeaderStyles, glassListRowStyles } from "../../UI/Components/GlassList";
import { Input } from "../../UI/Components/Input";
import { Modal } from "../../UI/Components/Modal";
import { Select } from "../../UI/Components/Select";
import { glassVariants } from "../../UI/Core/GlassManager/variants";
import { showToast } from "../../UI/Feedback/Toast";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";

export const SourceControl = React.memo(function SourceControl() {
  const { t } = useLocale();
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [isRepo, setIsRepo] = useState(false);
  const [files, setFiles] = useState<GitFile[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [hasRemote, setHasRemote] = useState(false);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [gitAction, setGitAction] = useState<string | null>(null);
  const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [discardTarget, setDiscardTarget] = useState<GitFile | null>(null);
  const [recoveries, setRecoveries] = useState<GitRecovery[]>([]);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [stagedExpanded, setStagedExpanded] = useState(true);
  const [unstagedExpanded, setUnstagedExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"changes" | "history">("changes");
  const context = useRef({ path: null as string | null, epoch: 0, active: false });
  const isCurrent = useCallback((path: string, epoch: number) => {
    const current = context.current;
    return current.active && current.path === path && current.epoch === epoch;
  }, []);

  const applyCache = useCallback((cache: SourceControlCache) => {
    setRepoPath(cache.repoPath);
    setIsRepo(cache.isRepo);
    setFiles(cache.files);
    setCommits(cache.commits || []);
    setBranch(cache.branch);
    setBranches(cache.branches);
    setHasRemote(cache.hasRemote);
    setAhead(cache.ahead);
    setBehind(cache.behind);
    setIsLoading(false);
  }, []);

  const fetchStatus = useCallback(
    async (path: string, background = false) => {
      const epoch = context.current.epoch;
      if (!isCurrent(path, epoch)) return;
      try {
        if (background) setIsRefreshing(true);
        const cache = await GitService.refresh(path);
        if (!cache || !isCurrent(path, epoch)) return;
        applyCache(cache);
        EventBus.emit("git:changes-count", cache.files.length);
      } catch (error) {
        if (!isCurrent(path, epoch)) return;
        console.error("Git status failed", error);
        if (!background)
          showToast(
            t("sourceControl.statusReadFailed").replace("{message}", String(error)),
            "error",
          );
      } finally {
        if (isCurrent(path, epoch)) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [applyCache, isCurrent, t],
  );

  const checkRepo = useCallback(
    async (path: string, background = false) => {
      if (!isCurrent(path, context.current.epoch)) return;
      if (!background) setIsLoading(true);
      await fetchStatus(path, background);
    },
    [fetchStatus, isCurrent],
  );

  useEffect(() => {
    let mounted = true;
    let activeRoot: string | null = null;
    context.current.active = true;
    const initialEpoch = context.current.epoch;
    const changeRoot = (path: string | null) => {
      const previous = context.current.path;
      if (previous) void GitIPC.cancel(previous).catch(() => undefined);
      context.current = { path, epoch: context.current.epoch + 1, active: true };
      activeRoot = path;
      setRepoPath(path);
      setGitAction(null);
      setDiscardTarget(null);
      setRecoveries([]);
      setRecoveryOpen(false);
      setIsRefreshing(false);
      setFiles([]);
      setCommits([]);
      setCommitMsg("");
    };

    const init = async () => {
      try {
        const config = await WorkspaceStore.get();
        const path = config.lastOpenedPath || null;
        if (!mounted || context.current.epoch !== initialEpoch) return;
        changeRoot(path);

        if (!path) {
          setIsLoading(false);
          return;
        }

        const cached = GitService.getCache(path);
        if (cached) {
          applyCache(cached);
          checkRepo(path, true);
        } else {
          setRepoPath(path);
          checkRepo(path, true);
        }
      } catch (error) {
        console.error(error);
        if (mounted) setIsLoading(false);
      }
    };

    init();

    const unsubRootChanged = EventBus.on("workspace:root-changed", (path: string) => {
      changeRoot(path || null);
      if (!path) {
        setIsLoading(false);
        return;
      }
      const cached = GitService.getCache(path);
      if (cached) {
        applyCache(cached);
        checkRepo(path, true);
      } else {
        setRepoPath(path);
        checkRepo(path);
      }
    });
    const unsubCache = GitService.subscribe((cache) => {
      if (mounted && cache?.repoPath === activeRoot) applyCache(cache);
    });

    return () => {
      mounted = false;
      context.current.active = false;
      context.current.epoch++;
      unsubRootChanged();
      unsubCache();
    };
  }, [applyCache, checkRepo]);

  const handleInit = async () => {
    if (!repoPath) return;
    const epoch = context.current.epoch;
    try {
      await GitIPC.init(repoPath);
      if (!isCurrent(repoPath, epoch)) return;
      await checkRepo(repoPath);
    } catch (error) {
      if (!isCurrent(repoPath, epoch)) return;
      showToast(t("sourceControl.initFailed").replace("{message}", String(error)), "error");
    }
  };

  const toggleStage = async (file: GitFile) => {
    if (!repoPath) return;
    const epoch = context.current.epoch;
    try {
      if (file.is_staged) await GitIPC.unstage(repoPath, file.path);
      else await GitIPC.add(repoPath, file.path);
      if (!isCurrent(repoPath, epoch)) return;
      await fetchStatus(repoPath, true);
    } catch (error) {
      if (!isCurrent(repoPath, epoch)) return;
      showToast(t("sourceControl.stageUpdateFailed").replace("{message}", String(error)), "error");
    }
  };

  const stageAll = async () => {
    if (!repoPath) return;
    const epoch = context.current.epoch;
    try {
      await GitIPC.add(repoPath, ".");
      if (!isCurrent(repoPath, epoch)) return;
      await fetchStatus(repoPath, true);
    } catch (error) {
      if (!isCurrent(repoPath, epoch)) return;
      showToast(t("sourceControl.stageAllFailed").replace("{message}", String(error)), "error");
    }
  };

  const unstageAll = async () => {
    if (!repoPath) return;
    const epoch = context.current.epoch;
    try {
      await GitIPC.unstageAll(repoPath);
      if (!isCurrent(repoPath, epoch)) return;
      await fetchStatus(repoPath, true);
    } catch (error) {
      if (!isCurrent(repoPath, epoch)) return;
      showToast(t("sourceControl.unstageAllFailed").replace("{message}", String(error)), "error");
    }
  };

  const handleCommit = async () => {
    if (!repoPath || !commitMsg.trim()) return;
    const epoch = context.current.epoch;
    try {
      const stagedFilesCount = files.filter((file) => file.is_staged).length;
      if (stagedFilesCount === 0) {
        showToast(t("sourceControl.stageFirst"), "warning");
        return;
      }

      await GitIPC.commit(repoPath, commitMsg);
      if (!isCurrent(repoPath, epoch)) return;
      setCommitMsg("");
      await fetchStatus(repoPath, true);
      if (!isCurrent(repoPath, epoch)) return;
      showToast(t("sourceControl.commitSuccess"), "success");
    } catch (error) {
      if (!isCurrent(repoPath, epoch)) return;
      showToast(t("sourceControl.commitFailed").replace("{message}", String(error)), "error");
    }
  };

  const runRepositoryAction = async (action: "fetch" | "pull" | "push", label: string) => {
    if (!repoPath || gitAction) return;
    const epoch = context.current.epoch;
    try {
      setGitAction(action);
      OutputService.append("source-control", `${label} started in ${repoPath}`);
      await GitIPC[action](repoPath);
      if (!isCurrent(repoPath, epoch)) return;
      await fetchStatus(repoPath, true);
      if (!isCurrent(repoPath, epoch)) return;
      OutputService.append("source-control", `${label} completed`);
      showToast(t("sourceControl.repoActionCompleted").replace("{label}", label), "success");
    } catch (error) {
      if (!isCurrent(repoPath, epoch)) return;
      OutputService.append("source-control", `${label} failed: ${error}`, "error");
      showToast(
        t("sourceControl.repoActionFailed")
          .replace("{label}", label)
          .replace("{message}", String(error)),
        "error",
      );
    } finally {
      if (isCurrent(repoPath, epoch)) setGitAction(null);
    }
  };

  const handleSwitchBranch = async (nextBranch: string) => {
    if (!repoPath || nextBranch === branch || gitAction) return;
    const epoch = context.current.epoch;
    try {
      setGitAction("switch");
      OutputService.append("source-control", `Switching branch from ${branch} to ${nextBranch}`);
      await GitIPC.switchBranch(repoPath, nextBranch);
      if (!isCurrent(repoPath, epoch)) return;
      await fetchStatus(repoPath, true);
      if (!isCurrent(repoPath, epoch)) return;
      showToast(t("sourceControl.branchSwitched").replace("{branch}", nextBranch), "success");
    } catch (error) {
      if (!isCurrent(repoPath, epoch)) return;
      OutputService.append("source-control", `Branch switch failed: ${error}`, "error");
      showToast(t("sourceControl.branchSwitchFailed").replace("{message}", String(error)), "error");
    } finally {
      if (isCurrent(repoPath, epoch)) setGitAction(null);
    }
  };

  const handleCreateBranch = async () => {
    if (!repoPath || !newBranchName.trim() || gitAction) return;
    const name = newBranchName.trim();
    const epoch = context.current.epoch;
    try {
      setGitAction("create-branch");
      OutputService.append("source-control", `Creating branch ${name}`);
      await GitIPC.createBranch(repoPath, name);
      if (!isCurrent(repoPath, epoch)) return;
      setNewBranchName("");
      setIsCreateBranchOpen(false);
      await fetchStatus(repoPath, true);
      if (!isCurrent(repoPath, epoch)) return;
      showToast(t("sourceControl.branchCreatedSwitched").replace("{name}", name), "success");
    } catch (error) {
      if (!isCurrent(repoPath, epoch)) return;
      OutputService.append("source-control", `Branch creation failed: ${error}`, "error");
      showToast(t("sourceControl.branchCreateFailed").replace("{message}", String(error)), "error");
    } finally {
      if (isCurrent(repoPath, epoch)) setGitAction(null);
    }
  };

  const openWorkingDiff = (file: GitFile) => {
    const target = `working:${file.is_staged ? "staged" : "unstaged"}:${encodeURIComponent(file.path)}`;
    useWorkbenchStore.getState().openTab({
      id: `diff-${target}`,
      type: "diff",
      title: `Diff: ${file.name}`,
      path: target,
    });
  };

  const confirmDiscardFile = async () => {
    if (!repoPath || !discardTarget || gitAction) return;
    const epoch = context.current.epoch;
    try {
      setGitAction("discard-file");
      await GitIPC.discardFile(repoPath, discardTarget.path);
      if (!isCurrent(repoPath, epoch)) return;
      setDiscardTarget(null);
      await fetchStatus(repoPath, true);
    } catch (error) {
      if (!isCurrent(repoPath, epoch)) return;
      showToast(t("sourceControl.discardFailed").replace("{message}", String(error)), "error");
    } finally {
      if (isCurrent(repoPath, epoch)) setGitAction(null);
    }
  };

  const runRecoveryAction = async (action: "discard" | "list" | "restore", hash?: string) => {
    if (!repoPath || gitAction) return;
    const epoch = context.current.epoch;
    setGitAction(`recovery-${action}`);
    try {
      if (action === "discard") await GitIPC.discardAll(repoPath);
      if (action === "restore" && hash) await GitIPC.restoreDiscard(repoPath, hash);
      const records = await GitIPC.listDiscardRecoveries(repoPath);
      if (!isCurrent(repoPath, epoch)) return;
      setRecoveries(records);
      setRecoveryOpen(action !== "restore");
      await fetchStatus(repoPath, true);
    } catch (error) {
      if (isCurrent(repoPath, epoch))
        showToast(t("sourceControl.recoveryFailed").replace("{message}", String(error)), "error");
    } finally {
      if (isCurrent(repoPath, epoch)) setGitAction(null);
    }
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case "M":
        return "text-[var(--StatusWarning)] bg-[var(--StatusWarning)]/10 border border-[var(--StatusWarning)]/20";
      case "A":
        return "text-[var(--StatusSuccess)] bg-[var(--StatusSuccess)]/10 border border-[var(--StatusSuccess)]/20";
      case "D":
        return "text-[var(--StatusError)] bg-[var(--StatusError)]/10 border border-[var(--StatusError)]/20";
      case "U":
      case "?":
        return "border border-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-accent)]";
      case "!":
        return "border border-[var(--StatusError)]/20 bg-[var(--StatusError)]/10 text-[var(--StatusError)]";
      default:
        return "text-[var(--color-text-muted)] bg-[var(--material-surface)] border border-transparent";
    }
  };

  const renderFileCard = (file: GitFile, index: number) => {
    const parentPath = file.path.split("/").slice(0, -1).join("/") || "/";
    return (
      <div
        key={`${file.path}-${index}`}
        className={cn(glassListRowStyles, "mx-1 my-0.5 cursor-pointer justify-between")}
      >
        <button
          type="button"
          onClick={() => openWorkingDiff(file)}
          className="mr-2 flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left"
        >
          <Icons.FileCode
            size={14}
            stroke={1.5}
            className="text-[var(--color-text-muted)] shrink-0"
          />
          <span className="text-[12.5px] font-medium text-[var(--color-text-highlight)] truncate min-w-0">
            {file.name}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] truncate opacity-70 group-hover:opacity-100 transition-opacity min-w-0">
            {parentPath}
          </span>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[10px] px-1.5 py-[1px] rounded flex items-center justify-center font-bold tracking-wide select-none ${getStatusBadgeStyle(file.status)}`}
          >
            {file.status}
          </span>
          <div className="opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all flex items-center shrink-0">
            {!file.is_staged && (
              <Tooltip content={t("sourceControl.discardFile")} delay={300}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDiscardTarget(file);
                  }}
                  className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--StatusError)]/10 hover:text-[var(--StatusError)]"
                >
                  <Icons.Trash size={11} stroke={2.2} />
                </button>
              </Tooltip>
            )}
            {file.is_staged ? (
              <Tooltip content={t("sourceControl.unstage")} delay={300}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleStage(file);
                  }}
                  className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--material-interactive-active)] hover:text-[var(--StatusError)]"
                >
                  <Icons.Minus size={11} stroke={3} />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={t("sourceControl.stage")} delay={300}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleStage(file);
                  }}
                  className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--material-interactive-active)] hover:text-[var(--color-text-highlight)]"
                >
                  <Icons.Plus size={11} stroke={3} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-transparent text-[var(--color-text-muted)] text-sm">
        {t("sourceControl.loadingStatus")}
      </div>
    );
  }

  if (!repoPath) {
    return (
      <EmptyState
        className="h-full"
        icon={<Icons.Folder size={27} stroke={1.45} />}
        title={t("sourceControl.noWorkspaceTitle")}
        description={t("sourceControl.noWorkspaceDescription")}
      />
    );
  }

  if (!isRepo) {
    return (
      <div className="flex flex-col h-full w-full bg-transparent">
        <SidebarPageHeader
          title={
            <>
              {t("sourceControl.panelTitle")}
              <Badge>Preview</Badge>
            </>
          }
        />
        <EmptyState
          className="flex-1"
          icon={<Icons.GitBranch size={27} stroke={1.45} />}
          title={t("sourceControl.notInitializedTitle")}
          actions={
            <button
              type="button"
              onClick={handleInit}
              className="flex items-center gap-2 rounded-control bg-[var(--color-accent)] px-5 py-2.5 text-[13px] font-bold text-[var(--color-accent-text)] transition-all hover:opacity-90 active:scale-[0.98]"
            >
              <Icons.Plus size={16} stroke={2.5} />
              {t("sourceControl.initRepository")}
            </button>
          }
        />
      </div>
    );
  }

  const conflictedFiles = files.filter((file) => file.is_conflict);
  const stagedFiles = files.filter((file) => file.is_staged && !file.is_conflict);
  const unstagedFiles = files.filter((file) => !file.is_staged && !file.is_conflict);

  return (
    <div className="flex flex-col h-full w-full select-none bg-transparent">
      <SidebarPageHeader
        title={
          <>
            {t("sourceControl.panelTitle")}
            <Badge>Preview</Badge>
          </>
        }
        actions={
          <div className="flex items-center gap-1">
            <Tooltip content={t("sourceControl.recoveryRecords")}>
              <button
                type="button"
                aria-label={t("sourceControl.recoveryRecords")}
                disabled={Boolean(gitAction)}
                onClick={() => void runRecoveryAction("list")}
                className="p-1.5 rounded-control hover:bg-[var(--material-interactive-hover)] disabled:opacity-40"
              >
                <Icons.History size={16} />
              </button>
            </Tooltip>
            <Tooltip content={t("sourceControl.discardAllRecoverable")}>
              <button
                type="button"
                aria-label={t("sourceControl.discardAllRecoverable")}
                disabled={Boolean(gitAction) || files.length === 0}
                onClick={() => void runRecoveryAction("discard")}
                className="p-1.5 rounded-control text-[var(--StatusError)] hover:bg-[var(--material-interactive-hover)] disabled:opacity-40"
              >
                <Icons.Trash size={16} />
              </button>
            </Tooltip>
            <Tooltip content={t("sourceControl.refresh")} delay={300}>
              <button
                type="button"
                onClick={() => repoPath && fetchStatus(repoPath, true)}
                disabled={isRefreshing}
                className="p-1.5 hover:bg-[var(--material-interactive-hover)] rounded-control text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] transition-colors disabled:opacity-50"
              >
                <Icons.Refresh
                  size={16}
                  className={isRefreshing ? "animate-spin text-[var(--color-text-highlight)]" : ""}
                />
              </button>
            </Tooltip>
          </div>
        }
      />

      <div className="px-[var(--PanelPaddingX)] mb-3 shrink-0">
        <FilterChips
          size="md"
          ariaLabel={t("sourceControl.changesTab")}
          value={activeTab}
          onChange={setActiveTab}
          items={[
            {
              id: "changes",
              label: t("sourceControl.changesTab"),
              icon: <Icons.GitBranch size={13} />,
            },
            {
              id: "history",
              label: t("sourceControl.historyTab"),
              icon: <Icons.History size={13} />,
            },
          ]}
        />
      </div>

      <div className="mx-[var(--PanelPaddingX)] mb-3 flex shrink-0 items-center gap-1.5">
        {(gitAction || isRefreshing) && (
          <Tooltip content={t("common.cancel")}>
            <button
              type="button"
              aria-label={t("common.cancel")}
              onClick={() =>
                void GitIPC.cancel(repoPath).catch((error) => showToast(String(error), "error"))
              }
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--StatusError)] hover:bg-[var(--material-interactive-hover)]"
            >
              <Icons.Close size={14} />
            </button>
          </Tooltip>
        )}
        {branch && branches.length > 0 ? (
          <Select
            ariaLabel={t("sourceControl.branchAria")}
            value={branch}
            onChange={(value) => void handleSwitchBranch(value)}
            options={branches.map((item) => ({
              value: item.name,
              label: item.name,
              disabled: Boolean(gitAction),
              disabledReason: gitAction ? t("sourceControl.gitBusy") : undefined,
            }))}
            className="h-7 min-w-0 flex-1 rounded-control px-2.5 text-[11.5px]"
          />
        ) : (
          <div className="flex h-7 min-w-0 flex-1 items-center rounded-control border border-[var(--border-subtle)] bg-[var(--material-surface)] px-2.5 text-[11.5px] text-[var(--color-text-muted)]">
            {t("sourceControl.noBranch")}
          </div>
        )}
        <Tooltip content={t("sourceControl.createBranch")} delay={300}>
          <button
            type="button"
            onClick={() => setIsCreateBranchOpen(true)}
            disabled={Boolean(gitAction)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:opacity-40"
          >
            <Icons.Plus size={14} />
          </button>
        </Tooltip>
        {hasRemote && (
          <>
            <Tooltip content={t("sourceControl.fetchUpdates")} delay={300}>
              <button
                type="button"
                onClick={() => void runRepositoryAction("fetch", "Fetch")}
                disabled={Boolean(gitAction)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:opacity-40"
              >
                <Icons.Refresh size={13} className={gitAction === "fetch" ? "animate-spin" : ""} />
              </button>
            </Tooltip>
            <Tooltip
              content={
                behind > 0
                  ? t("sourceControl.pullCount").replace("{count}", String(behind))
                  : t("sourceControl.pull")
              }
              delay={300}
            >
              <button
                type="button"
                onClick={() => void runRepositoryAction("pull", "Pull")}
                disabled={Boolean(gitAction)}
                className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:opacity-40"
              >
                <Icons.Pull size={13} />
                {behind > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-3 rounded-full bg-[var(--color-accent)] px-0.5 text-center text-[9px] leading-3 text-[var(--color-accent-text)]">
                    {behind}
                  </span>
                )}
              </button>
            </Tooltip>
            <Tooltip
              content={
                ahead > 0
                  ? t("sourceControl.pushCount").replace("{count}", String(ahead))
                  : t("sourceControl.push")
              }
              delay={300}
            >
              <button
                type="button"
                onClick={() => void runRepositoryAction("push", "Push")}
                disabled={Boolean(gitAction)}
                className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:opacity-40"
              >
                <Icons.Push size={13} />
                {ahead > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-3 rounded-full bg-[var(--color-accent)] px-0.5 text-center text-[9px] leading-3 text-[var(--color-accent-text)]">
                    {ahead}
                  </span>
                )}
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {activeTab === "changes" ? (
        <>
          <div className="mt-2 shrink-0 px-[var(--PanelPaddingX)] pb-4">
            <div
              className={cn(
                glassVariants({ layer: "raised" }),
                "relative flex flex-col gap-3 rounded-control p-3 transition-[border-color,box-shadow] focus-within:border-[var(--color-text-muted)]/25 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-text-muted)_14%,transparent)]",
              )}
            >
              <textarea
                data-aurona-input="embedded"
                className="w-full bg-transparent text-[13px] text-[var(--color-text-highlight)] outline-none resize-none placeholder-[var(--color-text-muted)] leading-relaxed"
                placeholder={t("sourceControl.commitPlaceholder")}
                rows={2}
                value={commitMsg}
                onChange={(event) => setCommitMsg(event.target.value)}
              />
              <div className="flex">
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={commitMsg.trim() === ""}
                  className="flex flex-1 items-center justify-center gap-2 rounded-control border border-[var(--border-subtle)] bg-[var(--material-surface)] px-4 py-2 text-[13px] font-medium text-[var(--color-text-highlight)] transition-colors hover:bg-[var(--material-interactive-active)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icons.Checks size={16} stroke={2} />
                  {t("sourceControl.commitAction")}
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-3 overflow-hidden px-[var(--PanelPaddingX)] pb-4 min-h-0">
            {conflictedFiles.length > 0 && (
              <div
                className={cn(
                  glassVariants({ layer: "base" }),
                  "flex max-h-[34%] min-h-0 flex-col overflow-hidden rounded-surface border-[color-mix(in_srgb,var(--DiagError)_20%,transparent)]",
                )}
              >
                <div className={cn(glassListHeaderStyles, "justify-between")}>
                  <span className="flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-wider text-[var(--StatusError)]">
                    <Icons.AlertTriangle size={14} /> {t("sourceControl.conflicts")} (
                    {conflictedFiles.length})
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {t("sourceControl.stageAfterResolve")}
                  </span>
                </div>
                <div className="aurona-scroll min-h-0 overflow-y-auto overflow-x-hidden p-2">
                  {conflictedFiles.map(renderFileCard)}
                </div>
              </div>
            )}
            {stagedFiles.length > 0 && (
              <div
                className={cn(
                  glassVariants({ layer: "base" }),
                  `flex flex-col min-h-0 ${stagedExpanded ? "flex-1" : "flex-initial"} rounded-surface overflow-hidden`,
                )}
              >
                <div className={cn(glassListHeaderStyles, "group justify-between")}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      const next = !stagedExpanded;
                      setStagedExpanded(next);
                      if (next) setUnstagedExpanded(false);
                    }}
                  >
                    <Icons.ChevronDown
                      size={15}
                      className={`text-[var(--color-text-muted)] transition-transform ${!stagedExpanded ? "-rotate-90" : ""}`}
                    />
                    <span className="text-[12.5px] font-bold text-[var(--color-text-highlight)] uppercase tracking-wider">
                      {t("sourceControl.staged")} ({stagedFiles.length})
                    </span>
                  </button>
                  <Tooltip content={t("sourceControl.unstageAll")} delay={300}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        unstageAll();
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-control text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--DiagError)]/80 transition-all flex items-center justify-center"
                    >
                      <Icons.Minus size={14} />
                    </button>
                  </Tooltip>
                </div>
                {stagedExpanded && (
                  <div className="flex-1 overflow-y-auto overflow-x-hidden aurona-scroll p-2 bg-transparent">
                    {stagedFiles.map(renderFileCard)}
                  </div>
                )}
              </div>
            )}

            {(unstagedFiles.length > 0 ||
              (stagedFiles.length === 0 && unstagedFiles.length === 0)) && (
              <div
                className={cn(
                  glassVariants({ layer: "base" }),
                  `flex flex-col min-h-0 ${unstagedExpanded && unstagedFiles.length > 0 ? "flex-1" : "flex-initial"} rounded-surface overflow-hidden`,
                )}
              >
                <div className={cn(glassListHeaderStyles, "group justify-between")}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      const next = !unstagedExpanded;
                      setUnstagedExpanded(next);
                      if (next) setStagedExpanded(false);
                    }}
                  >
                    <Icons.ChevronDown
                      size={15}
                      className={`text-[var(--color-text-muted)] transition-transform ${!unstagedExpanded ? "-rotate-90" : ""}`}
                    />
                    <span className="text-[12.5px] font-bold text-[var(--color-text-highlight)] uppercase tracking-wider">
                      {t("sourceControl.changes")} ({unstagedFiles.length})
                    </span>
                  </button>
                  {unstagedFiles.length > 0 && (
                    <Tooltip content={t("sourceControl.stageAll")} delay={300}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          stageAll();
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-control text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] transition-all flex items-center justify-center"
                      >
                        <Icons.Plus size={14} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                {unstagedExpanded &&
                  (unstagedFiles.length === 0 ? (
                    <div className="p-4 text-center text-[12px] text-[var(--color-text-muted)] bg-transparent">
                      {t("sourceControl.noChanges")}
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto overflow-x-hidden aurona-scroll p-2 bg-transparent">
                      {unstagedFiles.map(renderFileCard)}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto aurona-scroll px-[var(--PanelPaddingX)] pb-4">
          {commits.length === 0 ? (
            <div
              className={cn(
                glassVariants({ layer: "raised" }),
                "p-4 text-center text-[12px] text-[var(--color-text-muted)] rounded-surface z-10 mt-2",
              )}
            >
              {t("sourceControl.noCommits")}
            </div>
          ) : (
            <div className="flex flex-col gap-3 mt-2 relative z-10">
              {commits.map((commit) => (
                <button
                  type="button"
                  key={commit.hash}
                  className={cn(
                    glassVariants({ layer: "base", interactive: true }),
                    "flex flex-col rounded-control p-4 cursor-pointer hover:border-[var(--border-overlay)] group active:scale-[0.98]",
                  )}
                  onClick={() => {
                    EventBus.emit("app:open-tab", {
                      id: `diff-${commit.hash}`,
                      type: "diff",
                      title: `Diff: ${commit.hash.substring(0, 7)}`,
                      path: commit.hash,
                    });
                  }}
                >
                  <div className="flex flex-col gap-2 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[10px] px-2 py-0.5 rounded-control bg-[var(--material-surface)] text-[var(--color-text-highlight)] font-mono shrink-0 font-medium">
                        {commit.hash.substring(0, 7)}
                      </div>
                      <span className="text-[11px] text-[var(--color-text-muted)] opacity-80 font-medium">
                        {commit.date}
                      </span>
                    </div>
                    <div className="font-bold text-[13px] text-[var(--color-text-highlight)] leading-relaxed mt-1">
                      {commit.message}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border-subtle)] text-[12px] text-[var(--color-text-muted)] font-medium">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)] text-[10px] font-bold text-[var(--color-accent-text)]">
                      {commit.author.charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate">{commit.author}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <Modal
        isOpen={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        title={t("sourceControl.recoveryRecords")}
        icon={<Icons.History size={18} />}
      >
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {recoveries.length === 0 ? (
            <p>{t("sourceControl.noRecoveryRecords")}</p>
          ) : (
            recoveries.map((record) => (
              <div
                key={record.hash}
                className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-2"
              >
                <div className="min-w-0">
                  <div>{new Date(record.created).toLocaleString()}</div>
                  <code className="break-all text-xs">{record.hash}</code>
                </div>
                <Button
                  variant="secondary"
                  disabled={Boolean(gitAction) || files.length > 0}
                  onClick={() => void runRecoveryAction("restore", record.hash)}
                >
                  <Icons.History size={14} />
                  {t("sourceControl.restoreRecovery")}
                </Button>
              </div>
            ))
          )}
        </div>
      </Modal>
      <Modal
        isOpen={isCreateBranchOpen}
        onClose={() => setIsCreateBranchOpen(false)}
        title={t("sourceControl.createBranch")}
        icon={<Icons.GitBranch size={18} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreateBranchOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void handleCreateBranch()}
              disabled={!newBranchName.trim() || Boolean(gitAction)}
            >
              {t("sourceControl.createAndSwitch")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <span className="text-[12px] text-[var(--color-text-muted)]">
            {t("sourceControl.newBranchName")}
          </span>
          <Input
            fullWidth
            inputSize="md"
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleCreateBranch();
            }}
            placeholder={t("sourceControl.branchPlaceholder")}
          />
        </div>
      </Modal>
      <Modal
        isOpen={Boolean(discardTarget)}
        onClose={() => setDiscardTarget(null)}
        title={t("sourceControl.discardTitle")}
        icon={<Icons.AlertTriangle className="text-[var(--StatusError)]" size={18} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiscardTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void confirmDiscardFile()}>
              {t("workspace.discardChanges")}
            </Button>
          </>
        }
      >
        {t("sourceControl.discardFile")}: <strong>{discardTarget?.path}</strong>
      </Modal>
    </div>
  );
});
