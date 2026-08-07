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

  it("matches camel-case acronyms like gtd for goToDefinition", () => {
    const results = buildFliunoResults({
      commands: [
        command("editor.action.goToDefinition", "跳转到定义"),
        command("settings", "打开设置"),
      ],
      files: [],
      scope: "commands",
      query: "gtd",
      recentCommands: [],
      recentFiles: [],
      openFiles: [],
      excludedCommandId: "open-fliuno",
    });
    expect(results[0]?.id).toBe("command:editor.action.goToDefinition");
  });

  it("prefers shallow files and boosts currently open files", () => {
    const results = buildFliunoResults({
      commands: [],
      files: [
        { path: "C:/repo/src/deep/main.ts", relativePath: "src/deep/main.ts", name: "main.ts" },
        { path: "C:/repo/main.ts", relativePath: "main.ts", name: "main.ts" },
      ],
      scope: "files",
      query: "main",
      recentCommands: [],
      recentFiles: [],
      openFiles: ["C:/repo/main.ts"],
      excludedCommandId: "open-fliuno",
    });
    const first = results[0];
    expect(first?.kind).toBe("file");
    if (first?.kind === "file") expect(first.file.relativePath).toBe("main.ts");
  });

  it("returns nothing when the query cannot match", () => {
    const results = buildFliunoResults({
      commands: [command("save", "保存文件")],
      files: [{ path: "C:/repo/main.ts", relativePath: "main.ts", name: "main.ts" }],
      scope: "all",
      query: "zzz-不存在",
      recentCommands: [],
      recentFiles: [],
      openFiles: [],
      excludedCommandId: "open-fliuno",
    });
    expect(results).toHaveLength(0);
  });

  it("requires every whitespace-separated token to match (AND semantics)", () => {
    const results = buildFliunoResults({
      commands: [command("workbench.action.openSettings", "打开设置", "工作台")],
      files: [],
      scope: "all",
      query: "open settings",
      recentCommands: [],
      recentFiles: [],
      openFiles: [],
      excludedCommandId: "open-fliuno",
    });
    expect(results[0]?.id).toBe("command:workbench.action.openSettings");

    const none = buildFliunoResults({
      commands: [command("workbench.action.openSettings", "打开设置", "工作台")],
      files: [],
      scope: "all",
      query: "open nonsense",
      recentCommands: [],
      recentFiles: [],
      openFiles: [],
      excludedCommandId: "open-fliuno",
    });
    expect(none).toHaveLength(0);
  });

  it("understands common synonyms like prefs for settings", () => {
    const results = buildFliunoResults({
      commands: [command("workbench.action.openSettings", "打开设置", "工作台")],
      files: [],
      scope: "commands",
      query: "prefs",
      recentCommands: [],
      recentFiles: [],
      openFiles: [],
      excludedCommandId: "open-fliuno",
    });
    expect(results.some((result) => result.id === "command:workbench.action.openSettings")).toBe(
      true,
    );
  });

  it("reports highlight ranges for title matches", () => {
    const results = buildFliunoResults({
      commands: [],
      files: [{ path: "C:/repo/main.ts", relativePath: "main.ts", name: "main.ts" }],
      scope: "files",
      query: "main",
      recentCommands: [],
      recentFiles: [],
      openFiles: [],
      excludedCommandId: "open-fliuno",
    });
    expect(results[0]?.titleRanges).toEqual([[0, 4]]);
  });
});
