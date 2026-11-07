import { useCallback, useEffect, useRef, useState } from "react";
import {
  type GitBranch,
  type GitCommit,
  type GitFile,
  type GitRecovery,
  GitService,
  isGitCancellation,
  type SourceControlCache,
} from "../../../Core/Git";
import { OutputService } from "../../../Core/OutputService";
import { WorkspaceService } from "../../../Core/Workspace";
import { EventBus } from "../../../Foundation/EventBus";
import { useLocale } from "../../../Foundation/I18n";
import { useWorkbenchStore } from "../../../State/Workbench/useWorkbenchStore";
import { showToast } from "../../../UI/Feedback/Toast";

/** Owns panel state and subscriptions; GitService owns repository work and shared queries. */
export function useSourceControl() {
  const { t } = useLocale();
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [isRepo, setIsRepo] = useState(false);
  const [files, setFiles] = useState<GitFile[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
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
  const context = useRef({ path: null as string | null, epoch: 0, active: false });
  const pendingAction = useRef<symbol | null>(null);
  const isCurrent = useCallback((path: string, epoch: number) => {
    const current = context.current;
    return current.active && current.path === path && current.epoch === epoch;
  }, []);

  const applyCache = useCallback((cache: SourceControlCache) => {
    setRepoPath(cache.repoPath);
    setIsRepo(cache.isRepo);
    setFiles(cache.files);
    setCommits(cache.commits);
    setBranch(cache.branch);
    setBranches(cache.branches);
    setHasRemote(cache.hasRemote);
    setAhead(cache.ahead);
    setBehind(cache.behind);
    setStatusError(null);
    setIsLoading(false);
  }, []);

  const fetchStatus = useCallback(
    async (path: string, background = false) => {
      const epoch = context.current.epoch;
      if (!isCurrent(path, epoch)) return;
      setStatusError(null);
      if (background) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const cache = await GitService.refresh(path);
        if (!cache || !isCurrent(path, epoch)) return;
        applyCache(cache);
        EventBus.emit("git:changes-count", cache.files.length);
      } catch (error) {
        if (!isCurrent(path, epoch) || isGitCancellation(error)) return;
        setStatusError(error instanceof Error ? error.message : String(error));
        OutputService.append("source-control", `Git status failed: ${error}`, "error");
      } finally {
        if (isCurrent(path, epoch)) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [applyCache, isCurrent],
  );

  useEffect(() => {
    let mounted = true;
    context.current.active = true;
    const initialEpoch = context.current.epoch;
    const changeRoot = (path: string | null) => {
      if (context.current.path !== path) {
        context.current = { path, epoch: context.current.epoch + 1, active: true };
        pendingAction.current = null;
        setRepoPath(path);
        setIsRepo(false);
        setBranch("");
        setBranches([]);
        setHasRemote(false);
        setAhead(0);
        setBehind(0);
        setGitAction(null);
        setDiscardTarget(null);
        setRecoveries([]);
        setRecoveryOpen(false);
        setIsCreateBranchOpen(false);
        setNewBranchName("");
        setIsRefreshing(false);
        setStatusError(null);
        setFiles([]);
        setCommits([]);
        setCommitMsg("");
        EventBus.emit("git:changes-count", 0);
      }
      if (!path) {
        setIsLoading(false);
        return;
      }
      const cached = GitService.getCache(path);
      if (cached) applyCache(cached);
      void fetchStatus(path, Boolean(cached));
    };

    void WorkspaceService.whenInitialized()
      .then(() => {
        if (mounted && context.current.epoch === initialEpoch) {
          changeRoot(WorkspaceService.getCurrent().primaryRoot);
        }
      })
      .catch((error: unknown) => {
        if (!mounted || context.current.epoch !== initialEpoch) return;
        setStatusError(String(error));
        setIsLoading(false);
      });

    const unsubRootChanged = EventBus.on("workspace:root-changed", (path: string) => {
      changeRoot(path || null);
    });
    const unsubCache = GitService.subscribe((cache) => {
      if (mounted && cache && isCurrent(cache.repoPath ?? "", context.current.epoch)) {
        applyCache(cache);
        EventBus.emit("git:changes-count", cache.files.length);
      }
    });
    return () => {
      mounted = false;
      context.current.active = false;
      context.current.epoch++;
      pendingAction.current = null;
      unsubRootChanged();
      unsubCache();
      // A panel must not cancel shared repository queries or another consumer's write.
    };
  }, [applyCache, fetchStatus, isCurrent]);

  async function runAction<T>(
    action: string,
    work: (path: string) => Promise<T>,
    failureMessage: (error: unknown) => string,
    onSuccess?: (value: T) => void,
  ) {
    const epoch = context.current.epoch;
    if (!repoPath || !isCurrent(repoPath, epoch) || pendingAction.current) return;
    const owner = Symbol(action);
    pendingAction.current = owner;
    setGitAction(action);
    try {
      const result = await work(repoPath);
      if (isCurrent(repoPath, epoch)) onSuccess?.(result);
    } catch (error) {
      if (!isCurrent(repoPath, epoch) || isGitCancellation(error)) return;
      OutputService.append("source-control", `${action} failed: ${error}`, "error");
      showToast(failureMessage(error), "error");
    } finally {
      if (pendingAction.current === owner) pendingAction.current = null;
      if (isCurrent(repoPath, epoch)) setGitAction(null);
    }
  }

  const handleInit = () =>
    runAction(
      "init",
      (path) => GitService.init(path),
      (error) => t("sourceControl.initFailed").replace("{message}", String(error)),
    );
  const toggleStage = (file: GitFile) =>
    runAction(
      file.is_staged ? "unstage" : "stage",
      (path) =>
        file.is_staged ? GitService.unstage(path, file.path) : GitService.stage(path, file.path),
      (error) => t("sourceControl.stageUpdateFailed").replace("{message}", String(error)),
    );
  const stageAll = () =>
    runAction(
      "stage-all",
      (path) => GitService.stage(path, "."),
      (error) => t("sourceControl.stageAllFailed").replace("{message}", String(error)),
    );
  const unstageAll = () =>
    runAction(
      "unstage-all",
      (path) => GitService.unstageAll(path),
      (error) => t("sourceControl.unstageAllFailed").replace("{message}", String(error)),
    );

  const handleCommit = async () => {
    const message = commitMsg;
    if (!repoPath || !message.trim()) return;
    if (!files.some((file) => file.is_staged)) {
      showToast(t("sourceControl.stageFirst"), "warning");
      return;
    }
    await runAction(
      "commit",
      (path) => GitService.commit(path, message),
      (error) => t("sourceControl.commitFailed").replace("{message}", String(error)),
      () => {
        setCommitMsg((current) => (current === message ? "" : current));
        showToast(t("sourceControl.commitSuccess"), "success");
      },
    );
  };

  const runRepositoryAction = (action: "fetch" | "pull" | "push", label: string) =>
    runAction(
      action,
      (path) => {
        OutputService.append("source-control", `${label} started in ${path}`);
        return GitService[action](path);
      },
      (error) =>
        t("sourceControl.repoActionFailed")
          .replace("{label}", label)
          .replace("{message}", String(error)),
      () => {
        OutputService.append("source-control", `${label} completed`);
        showToast(t("sourceControl.repoActionCompleted").replace("{label}", label), "success");
      },
    );

  const handleSwitchBranch = (nextBranch: string) => {
    if (nextBranch === branch) return;
    return runAction(
      "switch",
      (path) => GitService.switchBranch(path, nextBranch),
      (error) => t("sourceControl.branchSwitchFailed").replace("{message}", String(error)),
      () => {
        showToast(t("sourceControl.branchSwitched").replace("{branch}", nextBranch), "success");
      },
    );
  };
  const handleCreateBranch = () => {
    const name = newBranchName.trim();
    if (!name) return;
    return runAction(
      "create-branch",
      (path) => GitService.createBranch(path, name),
      (error) => t("sourceControl.branchCreateFailed").replace("{message}", String(error)),
      () => {
        setNewBranchName("");
        setIsCreateBranchOpen(false);
        showToast(t("sourceControl.branchCreatedSwitched").replace("{name}", name), "success");
      },
    );
  };

  const openWorkingDiff = (file: GitFile) => {
    const target = `working:${file.is_staged ? "staged" : "unstaged"}:${encodeURIComponent(file.path)}`;
    useWorkbenchStore
      .getState()
      .openTab({ id: `diff-${target}`, type: "diff", title: `Diff: ${file.name}`, path: target });
  };
  const openCommitDiff = (hash: string) => {
    useWorkbenchStore.getState().openTab({
      id: `diff-${hash}`,
      type: "diff",
      title: `Diff: ${hash.substring(0, 7)}`,
      path: hash,
    });
  };
  const confirmDiscardFile = () => {
    if (!discardTarget) return;
    const target = discardTarget;
    return runAction(
      "discard-file",
      (path) => GitService.discardFile(path, target.path),
      (error) => t("sourceControl.discardFailed").replace("{message}", String(error)),
      () => {
        setDiscardTarget((current) => (current?.path === target.path ? null : current));
      },
    );
  };
  const runRecoveryAction = (action: "discard" | "list" | "restore", hash?: string) => {
    if (action === "restore" && !hash) return;
    return runAction(
      `recovery-${action}`,
      async (path) => {
        const epoch = context.current.epoch;
        if (action === "discard") await GitService.discardAll(path);
        if (action === "restore" && hash) await GitService.restoreDiscard(path, hash);
        return isCurrent(path, epoch) ? GitService.listDiscardRecoveries(path) : [];
      },
      (error) => t("sourceControl.recoveryFailed").replace("{message}", String(error)),
      (records) => {
        setRecoveries(records);
        setRecoveryOpen(action !== "restore");
      },
    );
  };
  const cancelAction = async () => {
    const epoch = context.current.epoch;
    if (!repoPath || !isCurrent(repoPath, epoch)) return;
    try {
      await GitService.cancel(repoPath);
    } catch (error) {
      if (isCurrent(repoPath, epoch) && !isGitCancellation(error))
        showToast(String(error), "error");
    }
  };

  return {
    repoPath,
    isRepo,
    files,
    commits,
    commitMsg,
    setCommitMsg,
    isLoading,
    isRefreshing,
    statusError,
    branch,
    branches,
    hasRemote,
    ahead,
    behind,
    gitAction,
    isCreateBranchOpen,
    setIsCreateBranchOpen,
    newBranchName,
    setNewBranchName,
    discardTarget,
    setDiscardTarget,
    recoveries,
    recoveryOpen,
    setRecoveryOpen,
    fetchStatus,
    handleInit,
    toggleStage,
    stageAll,
    unstageAll,
    handleCommit,
    runRepositoryAction,
    handleSwitchBranch,
    handleCreateBranch,
    openWorkingDiff,
    openCommitDiff,
    confirmDiscardFile,
    runRecoveryAction,
    cancelAction,
  };
}
