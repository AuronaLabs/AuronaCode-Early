import type { GitGutterDiffState } from "./useGitGutterDiff";

export function createEmptyDiffState(): GitGutterDiffState {
  return {
    addedLines: new Set(),
    modifiedLines: new Set(),
    deletedLines: new Set(),
  };
}

/**
 * 解析 git unified diff 文本，产出按新文件 0 基行号归类的变化行集合。
 * 语义：`+` 行为新增；紧跟删除的新增行为修改；未配对删除在新文件对应位置显示删除角标。
 */
export function parseUnifiedDiffHunks(diffText: string): GitGutterDiffState {
  const state = createEmptyDiffState();
  if (!diffText) return state;

  let newLine = 0;
  let pendingDeletes = 0;

  const flushDeletes = () => {
    if (pendingDeletes > 0) {
      state.deletedLines.add(newLine);
      pendingDeletes = 0;
    }
  };

  for (const line of diffText.split("\n")) {
    if (line.startsWith("@@")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) continue;
      flushDeletes();
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
      if (pendingDeletes > 0) {
        pendingDeletes--;
        state.modifiedLines.add(newLine);
      } else {
        state.addedLines.add(newLine);
      }
      newLine++;
      continue;
    }
    if (line.startsWith("-")) {
      pendingDeletes++;
      continue;
    }
    if (line.startsWith(" ")) {
      flushDeletes();
      newLine++;
    }
  }
  flushDeletes();
  return state;
}
