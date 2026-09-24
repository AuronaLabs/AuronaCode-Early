import { useCallback, useEffect, useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import { GitIPC } from "../../Foundation/IPC/GitCommands";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";

import { cn } from "../../Shared/Utils/cn";
import { EmptyState } from "../../UI/Components/EmptyState";
import { glassVariants } from "../../UI/Core/GlassManager/variants";
import { Icons } from "../../UI/Icons/IconManager";

interface DiffViewerProps {
  diffTarget: string;
}

interface ParsedDiffFile {
  oldName: string;
  newName: string;
  hunks: DiffHunk[];
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: "context" | "addition" | "deletion";
  content: string;
  leftLineNum: number | null;
  rightLineNum: number | null;
}

export function DiffViewer({ diffTarget }: DiffViewerProps) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [files, setFiles] = useState<ParsedDiffFile[]>([]);
  const workingTarget = diffTarget.match(/^working:(staged|unstaged):(.*)$/);
  const workingFile = workingTarget ? decodeURIComponent(workingTarget[2]) : null;
  const isStaged = workingTarget?.[1] === "staged";

  const parseGitDiff = useCallback((rawText: string) => {
    const lines = rawText.split("\n");
    let msg = "";
    let i = 0;

    while (i < lines.length && !lines[i].startsWith("diff --git")) {
      msg += `${lines[i]}\n`;
      i++;
    }
    setCommitMessage(msg.trim());

    const parsedFiles: ParsedDiffFile[] = [];
    let currentFile: ParsedDiffFile | null = null;
    let currentHunk: DiffHunk | null = null;

    let leftLineNumber = 0;
    let rightLineNumber = 0;

    for (; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("diff --git")) {
        const parts = line.split(" ");
        const oldName = parts[2]?.substring(2) || "unknown";
        const newName = parts[3]?.substring(2) || "unknown";

        currentFile = { oldName, newName, hunks: [] };
        parsedFiles.push(currentFile);
        continue;
      }

      if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("index ")) {
        continue;
      }

      if (line.startsWith("@@")) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          leftLineNumber = parseInt(match[1], 10);
          rightLineNumber = parseInt(match[2], 10);
        }
        currentHunk = { header: line, lines: [] };
        if (currentFile) currentFile.hunks.push(currentHunk);
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "deletion",
          content: line.substring(1),
          leftLineNum: leftLineNumber++,
          rightLineNum: null,
        });
      } else if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "addition",
          content: line.substring(1),
          leftLineNum: null,
          rightLineNum: rightLineNumber++,
        });
      } else if (line.startsWith(" ")) {
        currentHunk.lines.push({
          type: "context",
          content: line.substring(1),
          leftLineNum: leftLineNumber++,
          rightLineNum: rightLineNumber++,
        });
      }
    }

    setFiles(parsedFiles);
  }, []);

  useEffect(() => {
    async function loadDiff() {
      try {
        setLoading(true);
        setError(null);

        const config = await WorkspaceStore.get();
        const repoPath = config.lastOpenedPath || ".";

        const rawDiff = workingFile
          ? await GitIPC.getWorktreeDiff(repoPath, workingFile, isStaged)
          : await GitIPC.getCommitDiff(repoPath, diffTarget);
        parseGitDiff(rawDiff);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    loadDiff();
  }, [diffTarget, isStaged, parseGitDiff, workingFile]);

  const summary = files.reduce(
    (totals, file) => {
      totals.additions += file.hunks.reduce(
        (count, hunk) => count + hunk.lines.filter((line) => line.type === "addition").length,
        0,
      );
      totals.deletions += file.hunks.reduce(
        (count, hunk) => count + hunk.lines.filter((line) => line.type === "deletion").length,
        0,
      );
      return totals;
    },
    { additions: 0, deletions: 0 },
  );

  if (loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-[var(--color-text-muted)]">
        <div className="relative">
          <div className="absolute inset-0 scale-125 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] blur-xl" />
          <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_22%,var(--border-subtle))] bg-[var(--material-surface)] text-[var(--color-accent)]">
            <Icons.GitCommit size={24} stroke={1.45} />
          </div>
        </div>
        <span className="text-[12.5px]">{t("sourceControl.diffViewer.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <EmptyState
          icon={<Icons.AlertTriangle size={26} stroke={1.6} />}
          title={t("sourceControl.diffViewer.loadFailed")}
          description={error}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      <div className="shrink-0 px-4 pt-4">
        <div
          className={cn(
            glassVariants({ layer: "raised" }),
            "flex min-h-[68px] items-center justify-between gap-4 rounded-surface px-4 py-3",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-[var(--material-overlay)] text-[var(--color-accent)] shadow-[inset_0_1px_0_var(--GlassSurface-Rim)] backdrop-blur-[var(--glass-blur-overlay)]">
              <Icons.GitCommit size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                  {workingFile
                    ? t("sourceControl.diffViewer.title")
                    : t("sourceControl.diffViewer.commitTitle")}
                </span>
                <code className="rounded-full bg-[var(--material-surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {workingFile ?? diffTarget.slice(0, 8)}
                </code>
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-text-muted)]">
                {workingFile
                  ? isStaged
                    ? t("sourceControl.diffViewer.staged")
                    : t("sourceControl.diffViewer.unstaged")
                  : commitMessage || t("sourceControl.diffViewer.noCommitMessage")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px]">
            <span className="text-[var(--color-text-muted)]">
              {t("sourceControl.diffViewer.fileCount").replace("{count}", String(files.length))}
            </span>
            {summary.additions > 0 && (
              <span className="font-mono font-semibold text-[var(--StatusSuccess)]">
                +{summary.additions}
              </span>
            )}
            {summary.deletions > 0 && (
              <span className="font-mono font-semibold text-[var(--StatusError)]">
                −{summary.deletions}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="aurona-scroll flex-1 overflow-y-auto p-4">
        {files.length === 0 ? (
          <EmptyState
            icon={<Icons.FileCode size={27} stroke={1.45} />}
            title={t("sourceControl.diffViewer.empty")}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {files.map((file) => {
              const additions = file.hunks.reduce(
                (acc, hunk) => acc + hunk.lines.filter((l) => l.type === "addition").length,
                0,
              );
              const deletions = file.hunks.reduce(
                (acc, hunk) => acc + hunk.lines.filter((l) => l.type === "deletion").length,
                0,
              );

              return (
                <div
                  key={`${file.oldName}-${file.newName}`}
                  className={cn(
                    glassVariants({ layer: "raised" }),
                    "overflow-hidden rounded-surface",
                  )}
                >
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-base)] px-3 py-2.5 backdrop-blur-[var(--surface-blur-base)] backdrop-saturate-[var(--GlassSaturation)]">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-accent)]">
                        <Icons.FileCode size={14} />
                      </div>
                      <span className="truncate font-mono text-[12px] font-semibold text-[var(--color-text-highlight)]">
                        {file.oldName === file.newName
                          ? file.newName
                          : `${file.oldName} → ${file.newName}`}
                      </span>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] font-semibold">
                      {additions > 0 && (
                        <span className="text-[var(--StatusSuccess)]">+{additions}</span>
                      )}
                      {deletions > 0 && (
                        <span className="text-[var(--StatusError)]">−{deletions}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col bg-[var(--material-panel)] font-mono text-[12px] leading-[1.6]">
                    {file.hunks.map((hunk) => (
                      <div
                        key={hunk.header}
                        className="flex flex-col border-b border-[var(--border-subtle)] last:border-b-0"
                      >
                        <div className="border-b border-[var(--border-subtle)] bg-[var(--material-surface)] px-3 py-1.5 font-mono text-[10.5px] text-[var(--color-text-muted)] backdrop-blur-[var(--glass-blur-raised)]">
                          {hunk.header}
                        </div>
                        <div className="flex w-full">
                          {/* Left Pane */}
                          <div className="aurona-scroll w-1/2 overflow-x-auto border-r border-[var(--border-subtle)]">
                            <div className="flex min-w-max flex-col">
                              {hunk.lines.map((line) => {
                                const isContext = line.type === "context";
                                const isDel = line.type === "deletion";
                                const leftBg = isContext
                                  ? "bg-transparent"
                                  : isDel
                                    ? "bg-[var(--StatusError)]/8"
                                    : "bg-[var(--material-surface)]";
                                const leftText = isContext
                                  ? line.content
                                  : isDel
                                    ? line.content
                                    : "";

                                return (
                                  <div
                                    key={`left-${line.type}-${line.leftLineNum ?? "none"}-${line.rightLineNum ?? "none"}-${line.content}`}
                                    className="group flex h-[22px] items-stretch transition-colors hover:bg-[var(--material-interactive-hover)]"
                                    style={{
                                      contentVisibility: "auto",
                                      containIntrinsicSize: "22px",
                                    }}
                                  >
                                    <div className="flex w-[45px] shrink-0 select-none items-center justify-end border-r border-[var(--border-subtle)] bg-[var(--material-panel)] px-2 text-right text-[var(--color-text-muted)] opacity-60">
                                      {line.leftLineNum || ""}
                                    </div>
                                    <div
                                      className={`relative flex flex-1 items-center whitespace-pre px-4 ${leftBg} ${
                                        isDel
                                          ? "text-[var(--StatusError)]"
                                          : "text-[var(--color-text-primary)]"
                                      }`}
                                    >
                                      {isDel && (
                                        <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--StatusError)]/50" />
                                      )}
                                      {leftText || " "}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Right Pane */}
                          <div className="aurona-scroll w-1/2 overflow-x-auto">
                            <div className="flex min-w-max flex-col">
                              {hunk.lines.map((line) => {
                                const isContext = line.type === "context";
                                const isAdd = line.type === "addition";
                                const rightBg = isContext
                                  ? "bg-transparent"
                                  : isAdd
                                    ? "bg-[var(--StatusSuccess)]/8"
                                    : "bg-[var(--material-surface)]";
                                const rightText = isContext
                                  ? line.content
                                  : isAdd
                                    ? line.content
                                    : "";

                                return (
                                  <div
                                    key={`right-${line.type}-${line.leftLineNum ?? "none"}-${line.rightLineNum ?? "none"}-${line.content}`}
                                    className="group flex h-[22px] items-stretch transition-colors hover:bg-[var(--material-interactive-hover)]"
                                    style={{
                                      contentVisibility: "auto",
                                      containIntrinsicSize: "22px",
                                    }}
                                  >
                                    <div className="flex w-[45px] shrink-0 select-none items-center justify-end border-r border-[var(--border-subtle)] bg-[var(--material-panel)] px-2 text-right text-[var(--color-text-muted)] opacity-60">
                                      {line.rightLineNum || ""}
                                    </div>
                                    <div
                                      className={`relative flex flex-1 items-center whitespace-pre px-4 ${rightBg} ${
                                        isAdd
                                          ? "text-[var(--StatusSuccess)]"
                                          : "text-[var(--color-text-primary)]"
                                      }`}
                                    >
                                      {isAdd && (
                                        <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--StatusSuccess)]/50" />
                                      )}
                                      {rightText || " "}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
