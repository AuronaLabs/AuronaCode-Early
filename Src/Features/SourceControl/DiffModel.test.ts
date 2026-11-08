import { describe, expect, it } from "vitest";
import { alignDiffLines, parseDiff, supportsHunkAction } from "./DiffModel";

function patch(body: string[]) {
  return [
    "diff --git a/source file.ts b/source file.ts",
    "--- a/source file.ts",
    "+++ b/source file.ts",
    "@@ -1,3 +1,4 @@ example",
    ...body,
  ].join("\n");
}

describe("Git diff model", () => {
  it("keeps paths with spaces and treats header-like code as hunk content", () => {
    const result = parseDiff(patch(["---old", "+++new", " unchanged"]));
    expect(result.files[0]).toMatchObject({
      oldName: "source file.ts",
      newName: "source file.ts",
      additions: 1,
      deletions: 1,
    });
    expect(result.files[0].hunks[0].lines.map((line) => line.content)).toEqual([
      "--old",
      "++new",
      "unchanged",
    ]);
  });

  it("decodes Git octal UTF-8 and escaped characters in quoted paths", () => {
    const path = '"a/\\344\\270\\255\\346\\226\\207 \\"file\\".ts"';
    const next = path.replace('"a/', '"b/');
    const result = parseDiff(
      [
        `diff --git ${path} ${next}`,
        `--- ${path}`,
        `+++ ${next}`,
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
    );
    expect(result.files[0].newName).toBe('中文 "file".ts');
  });

  it("aligns replacements on the same row and pads only unmatched lines", () => {
    const file = parseDiff(patch([" first", "-old", "+new", "+extra", " last"])).files[0];
    const rows = alignDiffLines(file.hunks[0].lines);
    expect(rows.map((row) => [row.left?.content, row.right?.content])).toEqual([
      ["first", "first"],
      ["old", "new"],
      [undefined, "extra"],
      ["last", "last"],
    ]);
  });

  it("starts a new hunk for each file without leaking previous lines", () => {
    const raw = [
      patch(["-old", "+new"]),
      "diff --git a/next.ts b/next.ts",
      "--- a/next.ts",
      "+++ b/next.ts",
      "@@ -12,2 +20,2 @@",
      " same",
      "+added",
    ].join("\n");
    const { files } = parseDiff(raw);
    expect(files).toHaveLength(2);
    expect(files[1].hunks[0].lines[1]).toMatchObject({ rightLineNum: 21, content: "added" });
    expect(files[0].hunks[0].lines).toHaveLength(2);
    expect(supportsHunkAction(raw)).toBe(false);
  });

  it("preserves no-newline annotations without inventing code rows", () => {
    const file = parseDiff(patch(["-old", "\\ No newline at end of file", "+new"])).files[0];
    expect(file.hunks[0].lines).toHaveLength(2);
    expect(file.hunks[0].lines[0].noNewline).toBe(true);
    expect(file.hunks[0].lines[1].noNewline).toBeUndefined();
  });

  it.each([
    [
      "added",
      ["new file mode 100644", "--- /dev/null", "+++ b/new.ts", "@@ -0,0 +1 @@", "+new"],
      "new.ts",
    ],
    [
      "deleted",
      ["deleted file mode 100644", "--- a/new.ts", "+++ /dev/null", "@@ -1 +0,0 @@", "-old"],
      "new.ts",
    ],
    [
      "renamed",
      ["similarity index 100%", "rename from old name.ts", "rename to new name.ts"],
      "new name.ts",
    ],
  ])("identifies %s files and excludes unsafe partial staging", (status, headers, name) => {
    const raw = ["diff --git a/new.ts b/new.ts", ...headers].join("\n");
    expect(parseDiff(raw).files[0]).toMatchObject({ status, newName: name });
    expect(supportsHunkAction(raw)).toBe(false);
  });

  it("keeps binary and mode-only changes visible", () => {
    const { files } = parseDiff(
      [
        "diff --git a/logo.png b/logo.png",
        "Binary files a/logo.png and b/logo.png differ",
        "diff --git a/run.sh b/run.sh",
        "old mode 100644",
        "new mode 100755",
      ].join("\n"),
    );
    expect(files[0]).toMatchObject({ binary: true, hunks: [] });
    expect(files[1].metadata).toEqual(["old mode 100644", "new mode 100755"]);
  });

  it("accepts ordinary text patches while bounding actionable patch size", () => {
    const raw = patch(["-old", "+new"]);
    expect(supportsHunkAction(raw)).toBe(true);
    expect(supportsHunkAction(raw + " ".repeat(2_000_000))).toBe(false);
  });
});
