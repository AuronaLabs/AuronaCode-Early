import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { Icons } from "../../UI/Icons/IconManager";

import { showToast } from "../../UI/Feedback/Toast";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../../UI/Core/GlassManager/variants";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";

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

  useEffect(() => {
    async function loadDiff() {
      try {
        setLoading(true);
        setError(null);

        const config = await WorkspaceStore.get();
        const repoPath = config.lastOpenedPath || ".";

        const rawDiff: string = await invoke("git_diff_commit", {
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
  }, [commitHash]);

  const parseGitDiff = (rawText: string) => {
    const lines = rawText.split("\n");
    let msg = "";
    let i = 0;

    while (i < lines.length && !lines[i].startsWith("diff --git")) {
      msg += lines[i] + "\n";
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
  };

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--AppBackground)] text-[var(--TextMuted)]">
        <Icons.Refresh className="animate-spin mr-2" size={20} /> 加载差异数据中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--AppBackground)] text-red-500">
        <Icons.AlertTriangle size={32} className="mb-2" />
        <div>获取 Diff 失败</div>
        <div className="text-[12px] opacity-70 mt-1 max-w-md text-center">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--AppBackground)] overflow-hidden">
      <div className="flex-1 overflow-y-auto aurona-scroll p-6">
        {files.length === 0 ? (
          <div className="text-[var(--TextMuted)] text-center py-10">
            此提交未包含支持差异对比的文件
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {files.map((file, fileIdx) => {
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
                  key={fileIdx}
                  className={cn(glassVariants({ layer: "base" }), "rounded-xl overflow-hidden shadow-sm")}
                >
                  <div className="px-4 py-2.5 bg-[var(--GlassSurface-Elevated)] border-b border-[var(--GlassBorder)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icons.File size={16} className="text-[var(--TextMuted)]" />
                      <span className="text-[13px] font-bold text-[var(--TextHighlight)]">
                        {file.oldName === file.newName
                          ? file.newName
                          : `${file.oldName} -> ${file.newName}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[12px] font-mono font-bold tracking-wide">
                      {additions > 0 && <span className="text-green-500">+{additions}</span>}
                      {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
                    </div>
                  </div>

                  <div className="flex flex-col text-[13px] font-mono leading-[1.6]">
                    {file.hunks.map((hunk, hunkIdx) => (
                      <div
                        key={hunkIdx}
                        className="flex flex-col border-b border-[var(--GlassBorder)] last:border-b-0"
                      >
                        <div className="flex w-full">
                          {/* Left Pane */}
                          <div className="w-1/2 overflow-x-auto aurona-scroll border-r border-[var(--GlassBorder)]">
                            <div className="flex flex-col min-w-max">
                              {hunk.lines.map((line, lineIdx) => {
                                const isContext = line.type === "context";
                                const isDel = line.type === "deletion";
                                const leftBg = isContext
                                  ? "bg-transparent"
                                  : isDel
                                    ? "bg-red-500/10"
                                    : "bg-[var(--GlassSurface-Elevated)]";
                                const leftText = isContext ? line.content : isDel ? line.content : "";

                                return (
                                  <div
                                    key={lineIdx}
                                    className="flex group hover:bg-[var(--GlassHover)] transition-colors h-[22px] items-stretch"
                                    style={{
                                      contentVisibility: "auto",
                                      containIntrinsicSize: "22px",
                                    }}
                                  >
                                    <div className="w-[45px] shrink-0 border-r border-[var(--GlassBorder)] text-right px-2 flex items-center justify-end text-[var(--TextMuted)] opacity-60 select-none bg-[var(--GlassSurface-Elevated)]">
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
                              {hunk.lines.map((line, lineIdx) => {
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
                                    key={lineIdx}
                                    className="flex group hover:bg-[var(--GlassHover)] transition-colors h-[22px] items-stretch"
                                    style={{
                                      contentVisibility: "auto",
                                      containIntrinsicSize: "22px",
                                    }}
                                  >
                                    <div className="w-[45px] shrink-0 border-r border-[var(--GlassBorder)] text-right px-2 flex items-center justify-end text-[var(--TextMuted)] opacity-60 select-none bg-[var(--GlassSurface-Elevated)]">
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
