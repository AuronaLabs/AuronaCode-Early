import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandDefinition } from "../../Extension/CommandRegistry";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({}),
}));

import {
  type FliunoCoreContext,
  FliunoSearchSession,
  fuzzyScore,
  parseFliunoQuery,
  queryForScope,
  searchFliuno,
} from "./FliunoCore";

const mocks = vi.hoisted(() => ({
  client: {
    supports: vi.fn(),
    getDocumentSymbols: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  },
  workspace: {
    listFiles: vi.fn(),
    searchText: vi.fn(),
    cancel: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../../Foundation/IPC/WorkspaceSearchCommands", () => ({
  WorkspaceSearchIPC: mocks.workspace,
}));

vi.mock("../Language/LspClient", () => ({
  LspClient: {
    getInstance: () => mocks.client,
  },
}));

import type { WorkspaceFileEntry } from "../../Foundation/IPC/WorkspaceSearchCommands";
import { DocumentSymbolService } from "../Language/DocumentSymbolService";

const command = (id: string, title: string, category = "工作台"): CommandDefinition<unknown> => ({
  id,
  title,
  category,
  handler: () => undefined,
});

const file = (path: string, relativePath: string, name: string): WorkspaceFileEntry => ({
  path,
  relativePath,
  name,
});

const baseContext = (overrides: Partial<FliunoCoreContext> = {}): FliunoCoreContext => ({
  query: "",
  scope: "all",
  commands: [],
  files: [],
  recentCommands: [],
  recentFiles: [],
  openFiles: [],
  excludedCommandId: "workbench.action.openFliuno",
  requestId: "test-1",
  ...overrides,
});

describe("parseFliunoQuery", () => {
  it("recognizes every explicit prefix", () => {
    expect(parseFliunoQuery("> format", "all")).toEqual({
      scope: "commands",
      query: "format",
      explicitScope: true,
    });
    expect(parseFliunoQuery("@ main", "all").scope).toBe("files");
    expect(parseFliunoQuery("# symbol", "all").scope).toBe("symbols");
    expect(parseFliunoQuery(": content", "all").scope).toBe("content");
  });

  it("falls back to the selected scope without a prefix", () => {
    expect(parseFliunoQuery("settings", "commands").scope).toBe("commands");
    expect(parseFliunoQuery("settings", "commands").explicitScope).toBe(false);
  });
});

describe("queryForScope", () => {
  it("removes a conflicting explicit prefix when the user switches scope", () => {
    expect(queryForScope(">save", "files")).toBe("save");
    expect(queryForScope("@main.ts", "settings")).toBe("main.ts");
    expect(queryForScope("#foo", "content")).toBe("foo");
    expect(queryForScope(":text", "commands")).toBe("text");
  });

  it("keeps the query when the prefix already matches the selected scope", () => {
    expect(queryForScope(">save", "commands")).toBe(">save");
    expect(queryForScope("plain", "files")).toBe("plain");
  });
});

describe("matching", () => {
  it("prioritizes direct boundary matches over scattered fuzzy matches", () => {
    expect(fuzzyScore("format document", "format")).toBeGreaterThan(
      fuzzyScore("find references and move active tab", "format"),
    );
  });

  it("matches camel-case acronyms like gtd for goToDefinition", async () => {
    const results = await searchFliuno(
      baseContext({
        scope: "commands",
        query: "gtd",
        commands: [
          command("editor.action.goToDefinition", "跳转到定义"),
          command("settings", "打开设置"),
        ],
      }),
    );
    expect(results[0]?.id).toBe("command:editor.action.goToDefinition");
  });

  it("applies synonyms such as prefs for settings in the production path", async () => {
    const results = await searchFliuno(
      baseContext({
        scope: "commands",
        query: "prefs",
        commands: [command("workbench.action.openSettings", "打开设置", "工作台")],
      }),
    );
    expect(results.some((result) => result.id === "command:workbench.action.openSettings")).toBe(
      true,
    );
  });
});

describe("boosts", () => {
  it("boosts recently used commands on an empty query", async () => {
    const results = await searchFliuno(
      baseContext({
        scope: "commands",
        query: "",
        recentCommands: ["settings"],
        commands: [command("settings", "打开设置"), command("save", "保存文件")],
      }),
    );
    expect(results[0]?.id).toBe("command:settings");
  });

  it("boosts currently open files", async () => {
    const results = await searchFliuno(
      baseContext({
        scope: "files",
        query: "",
        files: [file("C:/repo/a.ts", "a.ts", "a.ts"), file("C:/repo/b.ts", "b.ts", "b.ts")],
        openFiles: ["C:/repo/b.ts"],
      }),
    );
    expect(results[0]?.id).toBe("file:C:/repo/b.ts");
  });
});

describe("settings provider", () => {
  it("returns settings with category and id for reveal navigation", async () => {
    const results = await searchFliuno(
      baseContext({
        scope: "settings",
        query: "流光",
      }),
    );
    const setting = results.find((result) => result.kind === "setting");
    expect(setting?.settingId).toBe("liquidTexture");
    expect(setting?.settingCategory).toBe("appearance");
  });
});

describe("symbol provider", () => {
  beforeEach(() => {
    DocumentSymbolService.clear();
    mocks.client.supports.mockReset();
    mocks.client.getDocumentSymbols.mockReset();
  });

  it("finds symbols from open files", async () => {
    mocks.client.supports.mockReturnValue(true);
    mocks.client.getDocumentSymbols.mockResolvedValue([
      { name: "myFunction", detail: "function", range: { start: { line: 3 } } },
    ]);
    const results = await searchFliuno(
      baseContext({
        scope: "symbols",
        query: "myFunction",
        openFileTabs: [{ path: "C:/repo/main.ts", language: "typescript" }],
      }),
    );
    expect(
      results.some((result) => result.kind === "symbol" && result.title === "myFunction"),
    ).toBe(true);
    expect(results[0]?.targetLine).toBe(4);
  });
});

describe("content provider", () => {
  beforeEach(() => {
    mocks.workspace.searchText.mockReset();
    mocks.workspace.cancel.mockReset();
  });

  it("keeps backend regex matches without a second fuzzy filter", async () => {
    mocks.workspace.searchText.mockResolvedValue({
      results: [
        {
          file_path: "src/a.ts",
          line_number: 2,
          index: 0,
          match_text: "foo something bar",
        },
      ],
    });
    const regexResults = await searchFliuno(
      baseContext({
        scope: "content",
        query: "foo.*bar",
        workspaceRoot: "C:/repo",
        contentRegex: true,
        requestId: "regex-1",
      }),
    );
    expect(regexResults).toHaveLength(1);
    expect(regexResults[0]?.kind).toBe("content");
    expect(regexResults[0]?.targetPath).toBe("C:/repo/src/a.ts");

    const plainResults = await searchFliuno(
      baseContext({
        scope: "content",
        query: "foo.*bar",
        workspaceRoot: "C:/repo",
        contentRegex: false,
        requestId: "plain-1",
      }),
    );
    expect(plainResults).toHaveLength(0);
  });

  it("does not drop case-sensitive backend matches in fuzzy mode", async () => {
    mocks.workspace.searchText.mockResolvedValue({
      results: [{ file_path: "src/b.ts", line_number: 1, index: 0, match_text: "Foo bar" }],
    });
    const results = await searchFliuno(
      baseContext({
        scope: "content",
        query: "foo",
        workspaceRoot: "C:/repo",
        contentCaseSensitive: true,
        requestId: "case-1",
      }),
    );
    expect(results).toHaveLength(1);
  });

  it("aligns descriptionRanges with the rendered description text exactly", async () => {
    mocks.workspace.searchText.mockResolvedValue({
      results: [
        {
          file_path: "src/main.rs",
          line_number: 42,
          index: 0,
          match_text: "    fn render_markdown() {",
        },
      ],
    });
    const results = await searchFliuno(
      baseContext({
        scope: "content",
        query: "render",
        workspaceRoot: "C:/repo",
        requestId: "align-1",
      }),
    );
    expect(results).toHaveLength(1);
    const item = results[0];
    expect(item).toBeDefined();
    const [start, end] = item?.descriptionRanges[0] ?? [0, 0];
    const highlightedSlice = item?.description.slice(start, end);
    expect(highlightedSlice?.toLowerCase()).toBe("render");
  });
});

describe("FliunoSearchSession", () => {
  beforeEach(() => {
    mocks.workspace.searchText.mockReset();
    mocks.workspace.cancel.mockReset();
  });

  it("rejects stale generations and keeps the latest result", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mocks.workspace.searchText.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const session = new FliunoSearchSession();
    const first = session.search(
      baseContext({
        scope: "content",
        query: "aaa",
        workspaceRoot: "C:/repo",
        requestId: "stale-1",
      }),
    );
    const second = session.search(
      baseContext({
        scope: "content",
        query: "bbb",
        workspaceRoot: "C:/repo",
        requestId: "stale-2",
      }),
    );
    await vi.waitFor(() => expect(mocks.workspace.searchText).toHaveBeenCalledTimes(2));
    resolvers[0]?.({
      results: [{ file_path: "a.ts", line_number: 1, index: 0, match_text: "aaa" }],
    });

    await expect(first).resolves.toEqual([]);
    resolvers[1]?.({
      results: [{ file_path: "b.ts", line_number: 1, index: 0, match_text: "bbb" }],
    });
    const latest = await second;
    expect(latest.some((result) => result.title === "b.ts")).toBe(true);
    expect(mocks.workspace.cancel).toHaveBeenCalled();
  });

  it("cancels the in-flight request", async () => {
    let resolveSearch: ((value: unknown) => void) | undefined;
    mocks.workspace.searchText.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const session = new FliunoSearchSession();
    const pending = session.search(
      baseContext({
        scope: "content",
        query: "aaa",
        workspaceRoot: "C:/repo",
        requestId: "cancel-1",
      }),
    );
    await vi.waitFor(() => expect(mocks.workspace.searchText).toHaveBeenCalledTimes(1));
    session.cancel();
    resolveSearch?.({
      results: [{ file_path: "a.ts", line_number: 1, index: 0, match_text: "aaa" }],
    });
    await expect(pending).resolves.toEqual([]);
    expect(mocks.workspace.cancel).toHaveBeenCalled();
  });
});
