import { useCallback, useEffect, useState } from "react";
import { Icons } from "../../UI/Icons/IconManager";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { EventBus } from "../../Foundation/EventBus";
import { showToast } from "../../UI/Feedback/Toast";
import { GitIPC, type GitFile, type GitCommit } from "../../Foundation/IPC/GitCommands";
import { GitService, type SourceControlCache } from "../../Core/GitService";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../../UI/Core/GlassManager/variants";

import React from "react";

export const SourceControl = React.memo(function SourceControl() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [isRepo, setIsRepo] = useState(false);
  const [files, setFiles] = useState<GitFile[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [branch, setBranch] = useState("");
  const [stagedExpanded, setStagedExpanded] = useState(true);
  const [unstagedExpanded, setUnstagedExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"changes" | "history">("changes");

  const applyCache = useCallback((cache: SourceControlCache) => {
    setRepoPath(cache.repoPath);
    setIsRepo(cache.isRepo);
    setFiles(cache.files);
    setCommits(cache.commits || []);
    setBranch(cache.branch);
    setIsLoading(false);
  }, []);

  const fetchStatus = useCallback(async (path: string, background = false) => {
    try {
      if (background) setIsRefreshing(true);
      const fullStatus = await GitIPC.getFullStatus(path);

      setFiles(fullStatus.files);
      setBranch(fullStatus.branch);
      setCommits(fullStatus.commits);
      GitService.setCache({
        repoPath: path,
        isRepo: true,
        files: fullStatus.files,
        commits: fullStatus.commits,
        branch: fullStatus.branch,
        checkedAt: Date.now(),
      });

      EventBus.emit("git:changes-count", fullStatus.files.length);
    } catch (error) {
      console.error("Git status failed", error);
      if (!background) showToast(`Git 状态读取失败：${error}`, "error");
    } finally {
      if (background) setIsRefreshing(false);
    }
  }, []);

  const checkRepo = useCallback(
    async (path: string, background = false) => {
      try {
        if (background) setIsRefreshing(true);
        else setIsLoading(true);

        const repoExists = await GitIPC.checkIsRepo(path);
        setRepoPath(path);
        setIsRepo(repoExists);

        if (repoExists) {
          await fetchStatus(path, background);
        } else {
          setFiles([]);
          setCommits([]);
          setBranch("");
          GitService.setCache({
            repoPath: path,
            isRepo: false,
            files: [],
            commits: [],
            branch: "",
            checkedAt: Date.now(),
          });
        }
      } catch (error) {
        console.error("Git repo check failed", error);
        if (!background) showToast(`Git 仓库检查失败：${error}`, "error");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [fetchStatus],
  );

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const config = await WorkspaceStore.get();
        const path = config.lastOpenedPath || null;
        if (!mounted) return;

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
      } catch (error) {
        console.error(error);
        if (mounted) setIsLoading(false);
      }
    };

    init();

    const unsubRootChanged = EventBus.on("workspace:root-changed", (path: string) => {
      const cached = GitService.getCache(path);
      if (cached) {
        applyCache(cached);
        checkRepo(path, true);
      } else {
        setRepoPath(path);
        checkRepo(path);
      }
    });

    return () => {
      mounted = false;
      unsubRootChanged();
    };
  }, [applyCache, checkRepo]);

  const handleInit = async () => {
    if (!repoPath) return;
    try {
      await GitIPC.init(repoPath);
      await checkRepo(repoPath);
    } catch (error) {
      showToast(`初始化 Git 仓库失败：${error}`, "error");
    }
  };

  const toggleStage = async (file: GitFile) => {
    if (!repoPath) return;
    try {
      if (file.is_staged) await GitIPC.unstage(repoPath, file.path);
      else await GitIPC.add(repoPath, file.path);
      await fetchStatus(repoPath, true);
    } catch (error) {
      showToast(`暂存状态更新失败：${error}`, "error");
    }
  };

  const stageAll = async () => {
    if (!repoPath) return;
    try {
      await GitIPC.add(repoPath, ".");
      await fetchStatus(repoPath, true);
    } catch (error) {
      showToast(`全部暂存失败：${error}`, "error");
    }
  };

  const unstageAll = async () => {
    if (!repoPath) return;
    try {
      await GitIPC.unstageAll(repoPath);
      await fetchStatus(repoPath, true);
    } catch (error) {
      showToast(`取消暂存失败：${error}`, "error");
    }
  };

  const handleCommit = async () => {
    if (!repoPath || !commitMsg.trim()) return;
    try {
      const stagedFilesCount = files.filter((file) => file.is_staged).length;
      if (stagedFilesCount === 0) await GitIPC.add(repoPath, ".");

      await GitIPC.commit(repoPath, commitMsg);
      setCommitMsg("");
      await fetchStatus(repoPath, true);
      showToast("提交成功", "success");
    } catch (error) {
      showToast(`提交失败：${error}`, "error");
    }
  };
  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case "M":
        return "text-amber-500 bg-amber-500/10 border border-amber-500/20";
      case "A":
        return "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20";
      case "D":
        return "text-red-500 bg-red-500/10 border border-red-500/20";
      case "U":
        return "text-blue-500 bg-blue-500/10 border border-blue-500/20";
      default:
        return "text-[var(--TextMuted)] bg-[var(--GlassSurface-Elevated)] border border-transparent";
    }
  };

  const renderFileCard = (file: GitFile, index: number) => {
    const parentPath = file.path.split("/").slice(0, -1).join("/") || "/";
    return (
      <div
        key={`${file.path}-${index}`}
        className="group relative flex items-center justify-between py-2 px-3 mx-1 my-0.5 rounded-lg border border-transparent hover:border-[var(--GlassBorder)] hover:bg-[var(--GlassHover)] transition-all cursor-pointer"
      >
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2 min-w-0">
          <Icons.FileCode size={14} stroke={1.5} className="text-[var(--TextMuted)] shrink-0" />
          <span className="text-[12.5px] font-medium text-[var(--TextHighlight)] truncate min-w-0">
            {file.name}
          </span>
          <span className="text-[10px] text-[var(--TextMuted)] truncate opacity-70 group-hover:opacity-100 transition-opacity min-w-0">
            {parentPath}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[10px] px-1.5 py-[1px] rounded flex items-center justify-center font-bold tracking-wide select-none ${getStatusBadgeStyle(file.status)}`}
          >
            {file.status}
          </span>
          <div className="opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all flex items-center shrink-0">
            {file.is_staged ? (
              <Tooltip content="取消暂存" delay={300}>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleStage(file);
                  }}
                  className="w-5 h-5 rounded-full bg-[var(--GlassSurface-Elevated)] border border-[var(--GlassBorder)] hover:bg-red-500/10 hover:text-red-500 text-[var(--TextPrimary)] flex items-center justify-center transition-all ml-1.5 shadow-sm"
                >
                  <Icons.Minus size={11} stroke={3} />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="暂存更改" delay={300}>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleStage(file);
                  }}
                  className="w-5 h-5 rounded-full bg-[var(--GlassSurface-Elevated)] border border-[var(--GlassBorder)] hover:bg-[var(--AccentPrimary)]/10 hover:text-[var(--AccentHover)] text-[var(--TextPrimary)] flex items-center justify-center transition-all ml-1.5 shadow-sm"
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
      <div className="flex h-full w-full items-center justify-center bg-transparent text-[var(--TextMuted)] text-sm">
        正在加载 Git 状态...
      </div>
    );
  }

  if (!repoPath) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center p-6 bg-transparent text-center gap-4">
        <Icons.Folder size={48} stroke={1} className="text-[var(--TextMuted)] opacity-50" />
        <p className="text-[13px] text-[var(--TextPrimary)] leading-relaxed">
          尚未打开任何工作区
          <br />
          请先在资源管理器中打开一个文件夹
        </p>
      </div>
    );
  }

  if (!isRepo) {
    return (
      <div className="flex flex-col h-full w-full bg-transparent">
        <div className="flex items-center justify-between px-[var(--PanelPaddingX)] pt-4 pb-2 shrink-0">
          <h2 className="text-[14px] font-bold text-[var(--TextHighlight)] tracking-tight flex items-center gap-2">
            源代码管理
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-500 uppercase tracking-wider">
              Beta
            </span>
          </h2>
        </div>
        <div className="flex flex-col flex-1 items-center justify-center p-6 text-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <Icons.GitBranch size={48} stroke={1} className="text-[var(--TextMuted)] opacity-50" />
            <p className="text-[13px] text-[var(--TextPrimary)] leading-relaxed mt-2">
              当前文件夹尚未初始化 Git 仓库
            </p>
          </div>
          <button
            onClick={handleInit}
            className="px-6 py-2.5 bg-[var(--AccentPrimary)] hover:opacity-90 text-white text-[13px] font-bold rounded-xl transition-all shadow-sm flex items-center gap-2"
          >
            <Icons.Plus size={16} stroke={2.5} />
            初始化 Git 仓库
          </button>
        </div>
      </div>
    );
  }

  const stagedFiles = files.filter((file) => file.is_staged);
  const unstagedFiles = files.filter((file) => !file.is_staged);

  return (
    <div className="flex flex-col h-full w-full select-none bg-transparent">
      <div className="flex items-center justify-between px-[var(--PanelPaddingX)] pt-4 pb-2 shrink-0">
        <h2 className="text-[14px] font-bold text-[var(--TextHighlight)] tracking-tight flex items-center gap-2">
          源代码管理
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-500 uppercase tracking-wider">
            Beta
          </span>
        </h2>

        <Tooltip content="刷新" delay={300}>
          <button
            onClick={() => repoPath && fetchStatus(repoPath, true)}
            disabled={isRefreshing}
            className="p-1.5 hover:bg-[var(--GlassHover)] rounded-lg text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] transition-colors disabled:opacity-50"
          >
            <Icons.Refresh
              size={16}
              className={isRefreshing ? "animate-spin text-[var(--TextHighlight)]" : ""}
            />
          </button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-1 mx-[var(--PanelPaddingX)] mb-3 shrink-0">
        <button
          className={`relative h-[26px] px-3 text-[12px] font-medium transition-colors duration-150 flex items-center justify-center gap-1.5 rounded-lg ${activeTab === "changes" ? "bg-[var(--GlassHover)] text-[var(--TextHighlight)]" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)]"}`}
          onClick={() => setActiveTab("changes")}
        >
          <Icons.GitBranch size={13} /> 更改
        </button>
        <button
          className={`relative h-[26px] px-3 text-[12px] font-medium transition-colors duration-150 flex items-center justify-center gap-1.5 rounded-lg ${activeTab === "history" ? "bg-[var(--GlassHover)] text-[var(--TextHighlight)]" : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)]"}`}
          onClick={() => setActiveTab("history")}
        >
          <Icons.History size={13} /> 历史
        </button>
      </div>

      {activeTab === "changes" ? (
        <>
          <div className="px-3 pb-4 shrink-0 mt-2">
            <div className={cn(glassVariants({ layer: "elevated" }), "flex flex-col p-3 rounded-2xl gap-3 relative transition-all")}>
              <textarea
                className="w-full bg-transparent text-[13px] text-[var(--TextHighlight)] outline-none resize-none placeholder-[var(--TextMuted)] leading-relaxed"
                placeholder="描述你的代码变更..."
                rows={2}
                value={commitMsg}
                onChange={(event) => setCommitMsg(event.target.value)}
              />
              <div className="flex">
                <button
                  onClick={handleCommit}
                  disabled={commitMsg.trim() === ""}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[var(--GlassSurface)] hover:bg-[var(--GlassHover)] border border-[var(--GlassBorder)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--TextHighlight)] text-[13px] font-medium rounded-lg transition-all"
                >
                  <Icons.Checks size={16} stroke={2} />
                  提交
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-3 overflow-hidden px-[var(--PanelPaddingX)] pb-4 min-h-0">
            {stagedFiles.length > 0 && (
              <div
                className={cn(glassVariants({ layer: "base" }), `flex flex-col min-h-0 ${stagedExpanded ? "flex-1" : "flex-initial"} rounded-2xl overflow-hidden shadow-sm`)}
              >
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer select-none border-b border-[var(--GlassBorder)] bg-[var(--GlassHover)]/20 group"
                  onClick={() => {
                    const next = !stagedExpanded;
                    setStagedExpanded(next);
                    if (next) setUnstagedExpanded(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icons.ChevronDown
                      size={15}
                      className={`text-[var(--TextMuted)] transition-transform ${!stagedExpanded ? "-rotate-90" : ""}`}
                    />
                    <span className="text-[12.5px] font-bold text-[var(--TextHighlight)] uppercase tracking-wider">
                      已暂存 ({stagedFiles.length})
                    </span>
                  </div>
                  <Tooltip content="全部取消暂存" delay={300}>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        unstageAll();
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-[var(--TextMuted)] hover:text-white hover:bg-red-500/80 transition-all flex items-center justify-center"
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
                className={cn(glassVariants({ layer: "base" }), `flex flex-col min-h-0 ${unstagedExpanded && unstagedFiles.length > 0 ? "flex-1" : "flex-initial"} rounded-2xl overflow-hidden shadow-sm`)}
              >
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer select-none border-b border-[var(--GlassBorder)] bg-[var(--GlassHover)]/20 group"
                  onClick={() => {
                    const next = !unstagedExpanded;
                    setUnstagedExpanded(next);
                    if (next) setStagedExpanded(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icons.ChevronDown
                      size={15}
                      className={`text-[var(--TextMuted)] transition-transform ${!unstagedExpanded ? "-rotate-90" : ""}`}
                    />
                    <span className="text-[12.5px] font-bold text-[var(--TextHighlight)] uppercase tracking-wider">
                      更改 ({unstagedFiles.length})
                    </span>
                  </div>
                  {unstagedFiles.length > 0 && (
                    <Tooltip content="全部暂存" delay={300}>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          stageAll();
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-[var(--TextMuted)] hover:text-white hover:bg-[var(--AccentPrimary)] transition-all flex items-center justify-center"
                      >
                        <Icons.Checks size={14} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                {unstagedExpanded &&
                  (unstagedFiles.length === 0 ? (
                    <div className="p-4 text-center text-[12px] text-[var(--TextMuted)] bg-transparent">
                      目前没有任何更改
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
        <div className="flex-1 overflow-y-auto aurona-scroll px-3 pb-4">
          {commits.length === 0 ? (
            <div className={cn(glassVariants({ layer: "elevated" }), "p-4 text-center text-[12px] text-[var(--TextMuted)] rounded-2xl z-10 mt-2 shadow-sm")}>
              尚未找到提交记录
            </div>
          ) : (
            <div className="flex flex-col gap-3 mt-2 relative z-10">
              {commits.map((commit, index) => (
                <div
                  key={`${commit.hash}-${index}`}
                  className={cn(glassVariants({ layer: "base", interactive: true }), "flex flex-col shadow-sm rounded-xl p-4 cursor-pointer hover:border-black/20 dark:hover:border-white/30 group active:scale-[0.98]")}
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
                      <div className="text-[10px] px-2 py-0.5 rounded-lg bg-[var(--GlassSurface-Elevated)] text-[var(--TextHighlight)] font-mono shrink-0 font-medium">
                        {commit.hash.substring(0, 7)}
                      </div>
                      <span className="text-[11px] text-[var(--TextMuted)] opacity-80 font-medium">
                        {commit.date}
                      </span>
                    </div>
                    <div className="font-bold text-[13px] text-[var(--TextHighlight)] leading-relaxed mt-1">
                      {commit.message}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--GlassBorder)] text-[12px] text-[var(--TextMuted)] font-medium">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[var(--AccentPrimary)] to-blue-600 text-white flex items-center justify-center text-[10px] font-bold shadow-sm">
                      {commit.author.charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate">{commit.author}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
