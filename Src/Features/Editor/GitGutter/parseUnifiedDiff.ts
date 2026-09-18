import type { GitGutterDiffState } from "./useGitGutterDiff";

export function createEmptyDiffState(): GitGutterDiffState {
  return {
    addedLines: new Set(),
    modifiedLines: new Set(),
    deletedLines: new Set(),
    hunks: [],
  };
}

export interface GitGutterHunkRow {
  kind: "add" | "del";
  text: string;
}

export interface GitGutterHunk {
  /** 0-based 首个变化行（纯删除块为删除角标所在行） */
  startLine: number;
  /** 0-based 末尾覆盖行（含删除角标行） */
  endLine: number;
  rows: GitGutterHunkRow[];
}

/**
 * 解析 git unified diff 文本，产出按新文件 0 基行号归类的变化行集合与 hunk 明细。
 * 语义：`+` 行为新增；紧跟删除的新增行为修改；未配对删除在新文件对应位置显示删除角标。
 */
export function parseUnifiedDiffHunks(diffText: string): GitGutterDiffState {
  const state = createEmptyDiffState();
  if (!diffText) return state;

  let newLine = 0;
  let pendingDeletes = 0;
  let current: GitGutterHunk | null = null;

  const closeHunk = () => {
    if (current) {
      if (current.rows.length > 0) state.hunks.push(current);
      current = null;
    }
  };

  const flushDeletes = () => {
    if (pendingDeletes > 0) {
      state.deletedLines.add(newLine);
      if (current) current.endLine = Math.max(current.endLine, newLine);
      pendingDeletes = 0;
    }
  };

  for (const line of diffText.split("\n")) {
    if (line.startsWith("@@")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) continue;
      flushDeletes();
      closeHunk();
      newLine = Number(match[1]) - 1; // 转为 0 基
      continue;
    }
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      if (!current) {
        current = { startLine: newLine, endLine: newLine, rows: [] };
      }
      const hunk = current;
      if (pendingDeletes > 0) {
        pendingDeletes--;
        state.modifiedLines.add(newLine);
      } else {
        state.addedLines.add(newLine);
      }
      hunk.endLine = Math.max(hunk.endLine, newLine);
      hunk.rows.push({ kind: "add", text: line.slice(1) });
      newLine++;
      continue;
    }
    if (line.startsWith("-")) {
      if (!current) {
        current = { startLine: newLine, endLine: newLine, rows: [] };
      }
      pendingDeletes++;
      current.rows.push({ kind: "del", text: line.slice(1) });
      continue;
    }
    if (line.startsWith(" ")) {
      flushDeletes();
      closeHunk();
      newLine++;
    }
  }
  flushDeletes();
  closeHunk();
  return state;
}

/** 命中行号所在的 hunk（覆盖删除角标行） */
export function findHunkAtLine(hunks: GitGutterHunk[], lineIndex: number): GitGutterHunk | null {
  return hunks.find((hunk) => lineIndex >= hunk.startLine && lineIndex <= hunk.endLine) ?? null;
}
