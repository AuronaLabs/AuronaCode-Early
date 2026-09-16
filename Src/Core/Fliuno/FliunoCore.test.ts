import { describe, expect, it } from "vitest";
import {
  acronymOf,
  fuzzyScore,
  matchQuery,
  mergeRanges,
  parseFliunoQuery,
  queryForScope,
} from "./FliunoCore";

describe("parseFliunoQuery 前缀路由", () => {
  it("显式前缀路由到对应 scope 并剥离前缀", () => {
    expect(parseFliunoQuery(">run", "all")).toEqual({
      scope: "commands",
      query: "run",
      explicitScope: true,
    });
    expect(parseFliunoQuery("@src/app.ts", "all")).toEqual({
      scope: "files",
      query: "src/app.ts",
      explicitScope: true,
    });
    expect(parseFliunoQuery("#init", "all")).toEqual({
      scope: "symbols",
      query: "init",
      explicitScope: true,
    });
    expect(parseFliunoQuery(":todo", "all")).toEqual({
      scope: "content",
      query: "todo",
      explicitScope: true,
    });
    expect(parseFliunoQuery("!demo", "all")).toEqual({
      scope: "extensions",
      query: "demo",
      explicitScope: true,
    });
  });

  it("无显式前缀时跟随所选 scope", () => {
    expect(parseFliunoQuery("theme", "files")).toEqual({
      scope: "files",
      query: "theme",
      explicitScope: false,
    });
    expect(parseFliunoQuery("   ", "commands")).toEqual({
      scope: "commands",
      query: "",
      explicitScope: false,
    });
  });

  it("queryForScope 移除与新 scope 冲突的旧前缀", () => {
    expect(queryForScope(">foo", "files")).toBe("foo");
    expect(queryForScope(":foo", "symbols")).toBe("foo");
    // 同 scope 或无前缀保持原样
    expect(queryForScope(">foo", "commands")).toBe(">foo");
    expect(queryForScope("foo", "commands")).toBe("foo");
  });
});

describe("matchQuery 字段加权与高亮区间", () => {
  it("单字段命中返回区间与得分", () => {
    const match = matchQuery("set", [{ text: "Settings", weight: 1, surface: "title" }]);
    expect(match).not.toBeNull();
    expect(match?.titleRanges).toEqual([[0, 3]]);
    expect(match?.descriptionRanges).toEqual([]);
    expect((match?.score ?? 0) > 0).toBe(true);
  });

  it("多字段取加权高分并归属正确表面", () => {
    // description 命中位置更靠前（起始命中 1000 分档），胜出
    const match = matchQuery("settings", [
      { text: "Open Settings", weight: 1, surface: "title" },
      { text: "settings preferences", weight: 1, surface: "description" },
    ]);
    expect(match?.descriptionRanges).toEqual([[0, 8]]);
    expect(match?.titleRanges).toEqual([]);

    // title 高权重可反超位置优势
    const weighted = matchQuery("settings", [
      { text: "Open Settings", weight: 5, surface: "title" },
      { text: "settings preferences", weight: 1, surface: "description" },
    ]);
    expect(weighted?.titleRanges).toEqual([[5, 13]]);
    expect(weighted?.descriptionRanges).toEqual([]);
  });

  it("任一 token 未命中返回 null", () => {
    expect(
      matchQuery("open missing", [{ text: "Open Settings", weight: 1, surface: "title" }]),
    ).toBeNull();
  });

  it("空查询得 0 分", () => {
    expect(matchQuery("   ", [{ text: "Settings", weight: 1, surface: "title" }])).toEqual({
      score: 0,
      titleRanges: [],
      descriptionRanges: [],
    });
  });
});

describe("fuzzyScore 边界与连续性", () => {
  it("直接前缀命中优于散乱子序列", () => {
    expect(fuzzyScore("fileman", "fileman")).toBeGreaterThan(
      fuzzyScore("f i l e m a n", "fileman"),
    );
  });

  it("词边界命中优于驼峰散布", () => {
    expect(fuzzyScore("f-man", "fman")).toBeGreaterThan(fuzzyScore("FileManager", "fman"));
  });

  it("多 token 全部命中才有得分", () => {
    expect(fuzzyScore("Open Settings", "open sett")).toBeGreaterThan(0);
    expect(fuzzyScore("Open Settings", "open missing")).toBe(-1);
    expect(fuzzyScore("anything", "")).toBe(0);
  });
});

describe("acronymOf 缩写", () => {
  it("驼峰取大写字母", () => {
    expect(acronymOf("FileManager")).toBe("fm");
    expect(acronymOf("OpenSettings")).toBe("os");
  });

  it("分隔符后取首字母", () => {
    expect(acronymOf("file-manager")).toBe("fm");
    expect(acronymOf("my.file.ts")).toBe("mft");
  });
});

describe("mergeRanges 区间合并", () => {
  it("合并重叠并保持有序", () => {
    const target: Array<[number, number]> = [];
    mergeRanges(target, [
      [5, 7],
      [0, 2],
      [6, 9],
    ]);
    expect(target).toEqual([
      [0, 2],
      [5, 9],
    ]);
  });

  it("相邻但离散的区间各自保留", () => {
    const target: Array<[number, number]> = [];
    mergeRanges(target, [
      [0, 2],
      [4, 6],
    ]);
    expect(target).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });
});
