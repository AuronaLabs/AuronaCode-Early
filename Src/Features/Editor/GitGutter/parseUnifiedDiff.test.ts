import { describe, expect, it } from "vitest";
import { parseUnifiedDiffHunks } from "./parseUnifiedDiff";

describe("parseUnifiedDiffHunks", () => {
  it("classifies added, modified and context lines", () => {
    const diff = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,4 +1,4 @@",
      " context",
      "-removed",
      "+replacement",
      "+appended",
    ].join("\n");

    const state = parseUnifiedDiffHunks(diff);
    // 0 基：context=行0，replacement=行1（修改），appended=行2（新增）
    expect(state.addedLines).toEqual(new Set([2]));
    expect(state.modifiedLines).toEqual(new Set([1]));
    // 删除发生在新文件行 2（context/replacement 之间未配对——本例已配对，无残留）
    expect(state.deletedLines.size).toBe(0);
  });

  it("maps trailing deletions to the hunk position", () => {
    const diff = ["@@ -1,3 +1,1 @@", " keep", "-gone1", "-gone2"].join("\n");

    const state = parseUnifiedDiffHunks(diff);
    expect(state.addedLines.size).toBe(0);
    // 两行删除都标记在新文件第 1 行（keep 之后）
    expect(state.deletedLines).toEqual(new Set([1]));
  });

  it("treats an untracked file diff as fully added", () => {
    const diff = [
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,3 @@",
      "+line one",
      "+line two",
      "+line three",
    ].join("\n");

    const state = parseUnifiedDiffHunks(diff);
    expect(state.addedLines).toEqual(new Set([0, 1, 2]));
    expect(state.modifiedLines.size).toBe(0);
  });

  it("handles multiple hunks and empty input", () => {
    const diff = ["@@ -2,2 +2,2 @@", " a", "-old", "+new", "@@ -10,1 +11,2 @@", "+extra"].join(
      "\n",
    );
    const state = parseUnifiedDiffHunks(diff);
    expect(state.modifiedLines).toEqual(new Set([2]));
    // hunk 头 +11（1 基）→ 0 基行 10
    expect(state.addedLines).toEqual(new Set([10]));

    expect(parseUnifiedDiffHunks("").addedLines.size).toBe(0);
  });
});
