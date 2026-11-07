import React, { useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import { cn } from "../../Shared/Utils/cn";
import { Badge } from "../../UI/Components/Badge";
import { Button } from "../../UI/Components/Button";
import { EmptyState } from "../../UI/Components/EmptyState";
import { FilterChips } from "../../UI/Components/FilterChips";
import { glassListHeaderStyles } from "../../UI/Components/GlassList";
import { Input } from "../../UI/Components/Input";
import { Modal } from "../../UI/Components/Modal";
import { Select } from "../../UI/Components/Select";
import { glassVariants } from "../../UI/Core/GlassManager/variants";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";
import { GitFileRow } from "./components/GitFileRow";
import { useSourceControl } from "./hooks/useSourceControl";

export const SourceControl = React.memo(function SourceControl() {
  const { t } = useLocale();
  const {
    repoPath,
    isRepo,
    files,
    commits,
    commitMsg,
    setCommitMsg,
    isLoading,
    isRefreshing,
    statusError,
    cancelAction,
    openCommitDiff,
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
    confirmDiscardFile,
    runRecoveryAction,
  } = useSourceControl();
  const [stagedExpanded, setStagedExpanded] = useState(true);
  const [unstagedExpanded, setUnstagedExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"changes" | "history">("changes");

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

  if (statusError && !isRepo) {
    return (
      <EmptyState
        className="h-full"
        icon={<Icons.AlertTriangle size={27} stroke={1.45} />}
        title={t("sourceControl.panelTitle")}
        description={t("sourceControl.statusReadFailed").replace("{message}", statusError)}
        actions={
          <Button variant="secondary" onClick={() => void fetchStatus(repoPath)}>
            {t("sourceControl.refresh")}
          </Button>
        }
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
              onClick={() => void cancelAction()}
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
                  {conflictedFiles.map((file) => (
                    <GitFileRow
                      key={`${file.path}:${file.is_staged}`}
                      file={file}
                      disabled={Boolean(gitAction)}
                      onOpen={openWorkingDiff}
                      onStage={toggleStage}
                      onDiscard={setDiscardTarget}
                    />
                  ))}
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
                    {stagedFiles.map((file) => (
                      <GitFileRow
                        key={`${file.path}:${file.is_staged}`}
                        file={file}
                        disabled={Boolean(gitAction)}
                        onOpen={openWorkingDiff}
                        onStage={toggleStage}
                        onDiscard={setDiscardTarget}
                      />
                    ))}
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
                      {unstagedFiles.map((file) => (
                        <GitFileRow
                          key={`${file.path}:${file.is_staged}`}
                          file={file}
                          disabled={Boolean(gitAction)}
                          onOpen={openWorkingDiff}
                          onStage={toggleStage}
                          onDiscard={setDiscardTarget}
                        />
                      ))}
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
                  onClick={() => openCommitDiff(commit.hash)}
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
