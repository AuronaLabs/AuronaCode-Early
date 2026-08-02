import { describe, expect, it } from "vitest";
import type { CommandDefinition } from "../../Extension/CommandRegistry";
import { buildFliunoResults, fuzzyScore, parseFliunoQuery } from "./FliunoSearch";

const command = (id: string, title: string, category = "工作台"): CommandDefinition<unknown> => ({
  id,
  title,
  category,
  handler: () => undefined,
});

describe("Fliuno search model", () => {
  it("recognizes command and file prefixes without mutating the visible query", () => {
    expect(parseFliunoQuery("> format", "all")).toEqual({
      scope: "commands",
      query: "format",
      explicitScope: true,
    });
    expect(parseFliunoQuery("@ src/main", "all").scope).toBe("files");
    expect(parseFliunoQuery("settings", "commands").scope).toBe("commands");
  });

  it("prioritizes direct boundary matches over scattered fuzzy matches", () => {
    expect(fuzzyScore("format document", "format")).toBeGreaterThan(
      fuzzyScore("find references and move active tab", "format"),
    );
  });

  it("combines real commands and files while keeping recent entries useful for an empty query", () => {
    const results = buildFliunoResults({
      commands: [command("save", "保存文件"), command("settings", "打开设置")],
      files: [
        { path: "C:/repo/src/main.ts", relativePath: "src/main.ts", name: "main.ts" },
        { path: "C:/repo/readme.md", relativePath: "readme.md", name: "readme.md" },
      ],
      scope: "all",
      query: "",
      recentCommands: ["settings"],
      recentFiles: [],
      openFiles: ["C:/repo/src/main.ts"],
      excludedCommandId: "open-fliuno",
    });

    expect(results.map((result) => result.id)).toEqual([
      "file:C:/repo/src/main.ts",
      "command:settings",
    ]);
  });

  it("honors scope and result limits", () => {
    const results = buildFliunoResults({
      commands: [command("save", "保存文件")],
      files: [{ path: "C:/repo/save.ts", relativePath: "save.ts", name: "save.ts" }],
      scope: "files",
      query: "save",
      recentCommands: [],
      recentFiles: [],
      openFiles: [],
      excludedCommandId: "open-fliuno",
      limit: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("file");
  });
});
