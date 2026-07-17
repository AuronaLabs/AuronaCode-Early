import { useCallback, useEffect, useState } from "react";
import { invokeDesktop } from "../../Foundation/Desktop";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";

import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../../UI/Core/GlassManager/variants";
import { Icons } from "../../UI/Icons/IconManager";

interface DiffViewerProps {
  commitHash: string;
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

export function DiffViewer({ commitHash }: DiffViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [files, setFiles] = useState<ParsedDiffFile[]>([]);

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

        const rawDiff = await invokeDesktop<string>("git_diff_commit", {
          path: repoPath,
          hash: commitHash,
        });
        parseGitDiff(rawDiff);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    loadDiff();
  }, [commitHash, parseGitDiff]);

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
      <div className="flex h-full w-full items-center justify-center bg-transparent p-6 text-[var(--TextMuted)]">
        <div
          className={cn(
            glassVariants({ layer: "elevated" }),
            "flex items-center gap-2.5 rounded-2xl px-5 py-3 text-[12px] shadow-sm",
          )}
        >
          <Icons.Refresh className="animate-spin" size={17} /> 加载差异数据中...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-transparent p-6">
        <div
          className={cn(
            glassVariants({ layer: "elevated" }),
            "flex max-w-md flex-col items-center rounded-2xl px-8 py-7 text-red-500 shadow-sm",
          )}
        >
          <Icons.AlertTriangle size={30} className="mb-2" />
          <div className="font-medium">获取 Diff 失败</div>
          <div className="mt-1 text-center text-[12px] opacity-70">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      <div className="shrink-0 px-4 pt-4">
        <div
          className={cn(
            glassVariants({ layer: "elevated" }),
            "flex min-h-[68px] items-center justify-between gap-4 rounded-2xl px-4 py-3 shadow-sm",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Floating)] text-[var(--TextHighlight)] shadow-sm">
              <Icons.GitCommit size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[var(--TextHighlight)]">
                  提交差异
                </span>
                <code className="rounded-md border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] px-1.5 py-0.5 text-[10px] text-[var(--TextMuted)]">
                  {commitHash.slice(0, 8)}
                </code>
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--TextMuted)]">
                {commitMessage || "此提交没有提供说明"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
            <span className="rounded-lg border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] px-2 py-1 text-[var(--TextMuted)]">
              {files.length} 个文件
            </span>
            {summary.additions > 0 && (
              <span className="rounded-lg border border-green-500/15 bg-green-500/10 px-2 py-1 font-mono text-green-600 dark:text-green-400">
                +{summary.additions}
              </span>
            )}
            {summary.deletions > 0 && (
              <span className="rounded-lg border border-red-500/15 bg-red-500/10 px-2 py-1 font-mono text-red-600 dark:text-red-400">
                -{summary.deletions}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="aurona-scroll flex-1 overflow-y-auto p-4">
        {files.length === 0 ? (
          <div
            className={cn(
              glassVariants({ layer: "base" }),
              "flex flex-col items-center rounded-2xl py-12 text-center text-[var(--TextMuted)]",
            )}
          >
            <Icons.FileCode size={26} className="mb-2 opacity-55" />
            <span className="text-[12px]">此提交未包含支持差异对比的文件</span>
          </div>
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
                    glassVariants({ layer: "elevated" }),
                    "overflow-hidden rounded-2xl shadow-sm",
                  )}
                >
                  <div className="flex items-center justify-between border-b border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] px-3 py-2.5 backdrop-blur-[var(--glass-blur-base)]">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Elevated)] text-[var(--TextMuted)]">
                        <Icons.FileCode size={14} />
                      </div>
                      <span className="truncate text-[12.5px] font-semibold text-[var(--TextHighlight)]">
                        {file.oldName === file.newName
                          ? file.newName
                          : `${file.oldName} -> ${file.newName}`}
                      </span>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] font-semibold">
                      {additions > 0 && (
                        <span className="rounded-md border border-green-500/15 bg-green-500/10 px-1.5 py-0.5 text-green-600 dark:text-green-400">
                          +{additions}
                        </span>
                      )}
                      {deletions > 0 && (
                        <span className="rounded-md border border-red-500/15 bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400">
                          -{deletions}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col bg-[var(--GlassSurface-Base)] font-mono text-[12px] leading-[1.6]">
                    {file.hunks.map((hunk) => (
                      <div
                        key={hunk.header}
                        className="flex flex-col border-b border-[var(--GlassBorder)] last:border-b-0"
                      >
                        <div className="border-b border-[var(--GlassBorder)] bg-[var(--GlassSurface-Elevated)] px-3 py-1.5 text-[10.5px] text-[var(--TextMuted)] backdrop-blur-[var(--glass-blur-elevated)]">
                          {hunk.header}
                        </div>
                        <div className="flex w-full">
                          {/* Left Pane */}
                          <div className="w-1/2 overflow-x-auto aurona-scroll border-r border-[var(--GlassBorder)]">
                            <div className="flex flex-col min-w-max">
                              {hunk.lines.map((line) => {
                                const isContext = line.type === "context";
                                const isDel = line.type === "deletion";
                                const leftBg = isContext
                                  ? "bg-transparent"
                                  : isDel
                                    ? "bg-red-500/10"
                                    : "bg-[var(--GlassSurface-Elevated)]";
                                const leftText = isContext
                                  ? line.content
                                  : isDel
                                    ? line.content
                                    : "";

                                return (
                                  <div
                                    key={`left-${line.type}-${line.leftLineNum ?? "none"}-${line.rightLineNum ?? "none"}-${line.content}`}
                                    className="flex group hover:bg-[var(--GlassHover)] transition-colors h-[22px] items-stretch"
                                    style={{
                                      contentVisibility: "auto",
                                      containIntrinsicSize: "22px",
                                    }}
                                  >
                                    <div className="flex w-[45px] shrink-0 select-none items-center justify-end border-r border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] px-2 text-right text-[var(--TextMuted)] opacity-60">
                                      {line.leftLineNum || ""}
                                    </div>
                                    <div
                                      className={`px-4 flex-1 flex items-center whitespace-pre ${leftBg} ${isDel ? "text-red-600 dark:text-red-400" : "text-[var(--TextPrimary)]"}`}
                                    >
                                      {leftText || " "}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Right Pane */}
                          <div className="w-1/2 overflow-x-auto aurona-scroll">
                            <div className="flex flex-col min-w-max">
                              {hunk.lines.map((line) => {
                                const isContext = line.type === "context";
                                const isAdd = line.type === "addition";
                                const rightBg = isContext
                                  ? "bg-transparent"
                                  : isAdd
                                    ? "bg-green-500/10"
                                    : "bg-[var(--GlassSurface-Elevated)]";
                                const rightText = isContext
                                  ? line.content
                                  : isAdd
                                    ? line.content
                                    : "";

                                return (
                                  <div
                                    key={`right-${line.type}-${line.leftLineNum ?? "none"}-${line.rightLineNum ?? "none"}-${line.content}`}
                                    className="flex group hover:bg-[var(--GlassHover)] transition-colors h-[22px] items-stretch"
                                    style={{
                                      contentVisibility: "auto",
                                      containIntrinsicSize: "22px",
                                    }}
                                  >
                                    <div className="flex w-[45px] shrink-0 select-none items-center justify-end border-r border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] px-2 text-right text-[var(--TextMuted)] opacity-60">
                                      {line.rightLineNum || ""}
                                    </div>
                                    <div
                                      className={`px-4 flex-1 flex items-center whitespace-pre ${rightBg} ${isAdd ? "text-green-600 dark:text-green-400" : "text-[var(--TextPrimary)]"}`}
                                    >
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
