import { useCallback, useEffect, useState } from "react";
import { Icons } from "../../UI/Icons/IconManager";
import { StorageManager } from "../../Core/StorageManager";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { EventBus } from "../../Core/EventBus";
import { showToast } from "../../UI/Feedback/Toast";
import { GitIPC, GitFile, GitCommit } from "../../Foundation/IPC/GitCommands";
import { GitService, SourceControlCache } from "../../Core/GitService";

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
      GitService.setCache({ repoPath: path, isRepo: true, files: fullStatus.files, commits: fullStatus.commits, branch: fullStatus.branch, checkedAt: Date.now() });
      
      EventBus.emit("git:changes-count", fullStatus.files.length);
    } catch (error) {
      console.error("Git status failed", error);
      if (!background) showToast(`Git 状态读取失败：${error}`, "error");
    } finally {
      if (background) setIsRefreshing(false);
    }
  }, []);

  const checkRepo = useCallback(async (path: string, background = false) => {
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
        GitService.setCache({ repoPath: path, isRepo: false, files: [], commits: [], branch: "", checkedAt: Date.now() });
      }
    } catch (error) {
      console.error("Git repo check failed", error);
      if (!background) showToast(`Git 仓库检查失败：${error}`, "error");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [fetchStatus]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const config = await StorageManager.getConfig();
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "M":
        return "text-[#eab308] bg-[#eab308]/10";
      case "A":
        return "text-[#22c55e] bg-[#22c55e]/10";
      case "D":
        return "text-[#ef4444] bg-[#ef4444]/10";
      case "U":
        return "text-[#22c55e] bg-[#22c55e]/10";
      default:
        return "text-[var(--ColorMuted)] bg-black/5";
    }
  };

  const renderFileCard = (file: GitFile, index: number) => {
    const parentPath = file.path.split("/").slice(0, -1).join("/") || "/";
    return (
      <div key={`${file.path}-${index}`} className="group relative flex items-center justify-between py-1.5 px-2 mb-1 rounded-xl bg-white/5 dark:bg-white/5 backdrop-blur-md border border-transparent hover:border-black/10 dark:hover:border-white/10 hover:shadow-sm transition-all cursor-pointer">
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          <Icons.FileCode size={14} stroke={1.5} className="text-[var(--ColorMuted)] shrink-0" />
          <span className="text-[12.5px] font-medium text-[var(--ColorTextHighlight)] truncate shrink-0">{file.name}</span>
          <span className="text-[10px] text-[var(--ColorMuted)] truncate opacity-70 group-hover:opacity-100 transition-opacity">{parentPath}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] px-1.5 py-[1px] rounded flex items-center justify-center font-bold tracking-wide ${getStatusColor(file.status)}`}>
            {file.status}
          </span>
          <div className="opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all flex items-center shrink-0">
            {file.is_staged ? (
              <Tooltip content="取消暂存" delay={300}>
                <button onClick={(event) => { event.stopPropagation(); toggleStage(file); }} className="p-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-red-500/10 hover:text-red-500 text-[var(--ColorText)] transition-colors ml-1.5">
                  <Icons.Minus size={13} stroke={2} />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="暂存更改" delay={300}>
                <button onClick={(event) => { event.stopPropagation(); toggleStage(file); }} className="p-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-[var(--ColorAccent)] hover:text-white text-[var(--ColorText)] transition-colors ml-1.5">
                  <Icons.Plus size={13} stroke={2} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center bg-transparent text-[var(--ColorMuted)] text-sm">正在加载 Git 状态...</div>;
  }

  if (!repoPath) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center p-6 bg-transparent text-center gap-4">
        <Icons.Folder size={48} stroke={1} className="text-[var(--ColorMuted)] opacity-50" />
        <p className="text-[13px] text-[var(--ColorText)] leading-relaxed">
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
          <h2 className="text-[14px] font-bold text-[var(--ColorTextHighlight)] tracking-tight flex items-center gap-2">
            源代码管理
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-500 uppercase tracking-wider">Beta</span>
          </h2>
        </div>
        <div className="flex flex-col flex-1 items-center justify-center p-6 text-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <Icons.GitBranch size={48} stroke={1} className="text-[var(--ColorMuted)] opacity-50" />
            <p className="text-[13px] text-[var(--ColorText)] leading-relaxed mt-2">当前文件夹尚未初始化 Git 仓库</p>
          </div>
          <button onClick={handleInit} className="px-6 py-2.5 bg-[var(--ColorAccent)] hover:opacity-90 text-white text-[13px] font-bold rounded-xl transition-all shadow-sm flex items-center gap-2">
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
        <h2 className="text-[14px] font-bold text-[var(--ColorTextHighlight)] tracking-tight flex items-center gap-2">
          源代码管理
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-500 uppercase tracking-wider">Beta</span>
        </h2>

        <Tooltip content="刷新" delay={300}>
          <button
            onClick={() => repoPath && fetchStatus(repoPath, true)}
            disabled={isRefreshing}
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] transition-colors disabled:opacity-50"
          >
            <Icons.Refresh size={16} className={isRefreshing ? "animate-spin text-[var(--ColorTextHighlight)]" : ""} />
          </button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-1 mx-[var(--PanelPaddingX)] mb-3 shrink-0">
        <button
          className={`relative h-[26px] px-3 text-[12px] font-medium transition-colors duration-150 flex items-center justify-center gap-1.5 rounded-md ${activeTab === "changes" ? "bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10"}`}
          onClick={() => setActiveTab("changes")}
        >
          <Icons.GitBranch size={13} /> 更改
        </button>
        <button
          className={`relative h-[26px] px-3 text-[12px] font-medium transition-colors duration-150 flex items-center justify-center gap-1.5 rounded-md ${activeTab === "history" ? "bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]" : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10"}`}
          onClick={() => setActiveTab("history")}
        >
          <Icons.History size={13} /> 历史
        </button>
      </div>

      {activeTab === "changes" ? (
        <>
          <div className="px-3 pb-4 shrink-0 mt-2">
            <div className="flex flex-col p-3 rounded-2xl bg-white/5 dark:bg-white/10 backdrop-blur-md border border-black/5 dark:border-white/5 shadow-inner gap-3 relative transition-all">
              <textarea
                className="w-full bg-transparent text-[13px] text-[var(--ColorTextHighlight)] outline-none resize-none placeholder-[var(--ColorMuted)] leading-relaxed"
                placeholder="描述你的代码变更..."
                rows={2}
                value={commitMsg}
                onChange={(event) => setCommitMsg(event.target.value)}
              />
              <div className="flex">
                <button
                  onClick={handleCommit}
                  disabled={commitMsg.trim() === ""}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 border border-[var(--ColorPanelBorder)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--ColorTextHighlight)] text-[13px] font-medium rounded-lg transition-all"
                >
                  <Icons.Checks size={16} stroke={2} />
                  提交
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-4 overflow-y-auto aurona-scroll pr-2 pb-4">
            {stagedFiles.length > 0 && (
              <div className="flex flex-col shrink-0">
                <div className="flex items-center justify-between px-1 mb-2 cursor-pointer select-none group" onClick={() => setStagedExpanded(!stagedExpanded)}>
                  <div className="flex items-center gap-1.5">
                    <Icons.ChevronDown size={14} className={`text-[var(--ColorMuted)] transition-transform ${!stagedExpanded ? "-rotate-90" : ""}`} />
                    <span className="text-[12px] font-bold text-[var(--ColorMuted)] uppercase tracking-wider group-hover:text-[var(--ColorTextHighlight)] transition-colors">
                      已暂存 ({stagedFiles.length})
                    </span>
                  </div>
                  <Tooltip content="全部取消暂存" delay={300}>
                    <button onClick={(event) => { event.stopPropagation(); unstageAll(); }} className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-[var(--ColorMuted)] hover:text-white hover:bg-red-500/80 transition-all">
                      <Icons.Minus size={14} />
                    </button>
                  </Tooltip>
                </div>
                {stagedExpanded && (
                  <div className="flex flex-col pl-2 border-l-2 border-black/5 dark:border-white/5 ml-2.5 mr-1">
                    {stagedFiles.map(renderFileCard)}
                  </div>
                )}
              </div>
            )}

            {(unstagedFiles.length > 0 || (stagedFiles.length === 0 && unstagedFiles.length === 0)) && (
              <div className="flex flex-col shrink-0">
                <div className="flex items-center justify-between px-1 mb-2 cursor-pointer select-none group" onClick={() => setUnstagedExpanded(!unstagedExpanded)}>
                  <div className="flex items-center gap-1.5">
                    <Icons.ChevronDown size={14} className={`text-[var(--ColorMuted)] transition-transform ${!unstagedExpanded ? "-rotate-90" : ""}`} />
                    <span className="text-[12px] font-bold text-[var(--ColorMuted)] uppercase tracking-wider group-hover:text-[var(--ColorTextHighlight)] transition-colors">
                      更改 ({unstagedFiles.length})
                    </span>
                  </div>
                  {unstagedFiles.length > 0 && (
                    <Tooltip content="全部暂存" delay={300}>
                      <button onClick={(event) => { event.stopPropagation(); stageAll(); }} className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-[var(--ColorMuted)] hover:text-white hover:bg-[var(--ColorAccent)] transition-all">
                        <Icons.Checks size={14} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                {unstagedExpanded &&
                  (unstagedFiles.length === 0 ? (
                    <div className="p-4 text-center text-[12px] text-[var(--ColorMuted)] border border-dashed border-black/10 dark:border-white/10 rounded-2xl ml-2.5 mr-3">
                      目前没有任何更改
                    </div>
                  ) : (
                    <div className="flex flex-col pl-2 border-l-2 border-black/5 dark:border-white/5 ml-2.5 mr-1 pb-2">
                      {unstagedFiles.map(renderFileCard)}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto aurona-scroll px-3 pb-4 flex flex-col gap-2 relative">
          {commits.length === 0 ? (
            <div className="p-4 text-center text-[12px] text-[var(--ColorMuted)] bg-white/5 dark:bg-white/10 backdrop-blur-md rounded-2xl z-10 mt-2 border border-black/5 dark:border-white/5 shadow-sm">
              尚未找到提交记录
            </div>
          ) : (
            commits.map((commit, index) => (
              <div key={`${commit.hash}-${index}`} className="flex flex-col bg-white/5 dark:bg-white/10 backdrop-blur-md border border-black/5 dark:border-white/5 shadow-sm rounded-2xl p-4 z-10 hover:border-black/20 dark:hover:border-white/20 transition-all group mt-2">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-medium text-[13px] text-[var(--ColorTextHighlight)] leading-snug">
                    {commit.message}
                  </div>
                  <div className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[var(--ColorMuted)] font-mono shrink-0 select-text">
                    {commit.hash}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px] text-[var(--ColorMuted)]">
                  <span className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full bg-[var(--ColorAccent)] text-white flex items-center justify-center text-[8px] font-bold">
                      {commit.author.charAt(0).toUpperCase()}
                    </div>
                    {commit.author}
                  </span>
                  <span>{commit.date}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});
