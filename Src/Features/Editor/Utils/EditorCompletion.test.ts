import { describe, expect, it } from "vitest";
import type { CompletionItem } from "../../../Foundation/Types/Lsp";
import { rankCompletionItems } from "./EditorCompletion";

const item = (label: string, sortText?: string): CompletionItem => ({ label, sortText });

describe("rankCompletionItems", () => {
  it("filters by the typed prefix and keeps stable ordering", () => {
    const items = [item("foobar"), item("bar"), item("foo"), item("FooBar")];
    const ranked = rankCompletionItems(items, "foo");
    // 保持原有 localeCompare 语义（大小写不归一），只做前缀过滤 + 排序 + 截断。
    expect(ranked.map((entry) => entry.label)).toEqual(["foo", "foobar", "FooBar"]);
  });

  it("uses sortText when present", () => {
    const items = [item("zebra", "1"), item("apple", "0")];
    expect(rankCompletionItems(items, "").map((entry) => entry.label)).toEqual(["apple", "zebra"]);
  });

  it("bounds the result list", () => {
    const items = Array.from({ length: 150 }, (_, index) => item(`item-${index}`));
    expect(rankCompletionItems(items, "", 10)).toHaveLength(10);
  });
});
