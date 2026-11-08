export interface DiffLine {
  type: "context" | "addition" | "deletion";
  content: string;
  leftLineNum: number | null;
  rightLineNum: number | null;
  noNewline?: boolean;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldName: string;
  newName: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied";
  binary: boolean;
  metadata: string[];
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface DiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

// Git quotes non-ASCII paths with C escapes, including octal UTF-8 bytes.
function decodePath(value: string, stripPrefix = false): string {
  let decoded = value;
  if (value.startsWith('"') && value.endsWith('"')) {
    const bytes: number[] = [];
    const encoder = new TextEncoder();
    const escapes: Record<string, number> = {
      a: 7,
      b: 8,
      t: 9,
      n: 10,
      v: 11,
      f: 12,
      r: 13,
      "\\": 92,
      '"': 34,
    };
    const source = value.slice(1, -1);
    for (let index = 0; index < source.length; index++) {
      const character = source[index];
      if (character === "\\") {
        const octal = source.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0];
        if (octal) {
          bytes.push(parseInt(octal, 8));
          index += octal.length;
        } else {
          bytes.push(escapes[source[++index]] ?? 63);
        }
      } else {
        const codePoint = source.codePointAt(index) ?? 0;
        bytes.push(...encoder.encode(String.fromCodePoint(codePoint)));
        if (codePoint > 0xffff) index++;
      }
    }
    decoded = new TextDecoder().decode(new Uint8Array(bytes));
  }
  return stripPrefix ? decoded.replace(/^[ab]\//, "") : decoded;
}

export function parseDiff(raw: string): { message: string; files: DiffFile[] } {
  const files: DiffFile[] = [];
  const message: string[] = [];
  let file: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  let left = 0;
  let right = 0;
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // Text paths are refined by ---/+++; rename/copy paths by their metadata.
      const paths = line.slice(11).match(/^(".*?"|a\/.*?) ("b\/.*"|b\/.*)$/);
      const oldName = decodePath(paths?.[1] ?? line.slice(11), true);
      const newName = decodePath(paths?.[2] ?? paths?.[1] ?? line.slice(11), true);
      file = {
        oldName,
        newName,
        status: "modified",
        binary: false,
        metadata: [],
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file) {
      message.push(line);
      continue;
    }
    const range = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (range) {
      left = Number(range[1]);
      right = Number(range[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    // Inside a hunk, --- and +++ are code, not path headers.
    if (hunk) {
      if (line.startsWith("\\ No newline at end of file")) {
        const previous = hunk.lines.at(-1);
        if (previous) previous.noNewline = true;
      } else if (line.startsWith("-")) {
        hunk.lines.push({
          type: "deletion",
          content: line.slice(1),
          leftLineNum: left++,
          rightLineNum: null,
        });
        file.deletions++;
      } else if (line.startsWith("+")) {
        hunk.lines.push({
          type: "addition",
          content: line.slice(1),
          leftLineNum: null,
          rightLineNum: right++,
        });
        file.additions++;
      } else if (line.startsWith(" ")) {
        hunk.lines.push({
          type: "context",
          content: line.slice(1),
          leftLineNum: left++,
          rightLineNum: right++,
        });
      }
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const path = decodePath(line.slice(4).split("\t")[0], true);
      if (path === "/dev/null") {
        file.status = line.startsWith("---") ? "added" : "deleted";
      } else if (line.startsWith("---")) {
        file.oldName = path;
      } else {
        file.newName = path;
      }
    } else if (line.startsWith("rename from ") || line.startsWith("copy from ")) {
      file.oldName = decodePath(line.slice(line.indexOf("from ") + 5));
      file.status = line.startsWith("rename") ? "renamed" : "copied";
    } else if (line.startsWith("rename to ") || line.startsWith("copy to ")) {
      file.newName = decodePath(line.slice(line.indexOf("to ") + 3));
    } else if (/^(Binary files |GIT binary patch)/.test(line)) {
      file.binary = true;
    } else if (/^(old mode |new mode |new file mode |deleted file mode )/.test(line)) {
      file.metadata.push(line);
      if (line.startsWith("new file")) file.status = "added";
      if (line.startsWith("deleted file")) file.status = "deleted";
    }
  }
  // New/deleted files share the actual path rather than exposing /dev/null.
  for (const item of files) {
    if (item.status === "added") item.oldName = item.newName;
    if (item.status === "deleted") item.newName = item.oldName;
  }
  return { message: message.join("\n").trim(), files };
}

export function alignDiffLines(lines: DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.type === "context") {
      rows.push({ left: line, right: line });
      index++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && lines[index].type !== "context") {
      const change = lines[index++];
      (change.type === "deletion" ? removed : added).push(change);
    }
    for (let row = 0; row < Math.max(removed.length, added.length); row++) {
      rows.push({ left: removed[row] ?? null, right: added[row] ?? null });
    }
  }
  return rows;
}

export function supportsHunkAction(diff: string): boolean {
  if (diff.length > 2_000_000) return false;
  const header = diff.split("\n@@ -", 1)[0];
  return (
    header.startsWith("diff --git ") &&
    header.includes("\n--- ") &&
    header.includes("\n+++ ") &&
    !diff.slice(header.length).includes("\ndiff --git ") &&
    !header
      .split("\n")
      .some((line) =>
        /^(new file mode |deleted file mode |old mode |new mode |rename |copy |similarity index |Binary files |GIT binary patch|--- \/dev\/null|\+\+\+ \/dev\/null)/.test(
          line,
        ),
      )
  );
}
