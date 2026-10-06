import { selectHotViews } from "./HotViewCache";

it("keeps at most twelve recently active views across one hundred tabs", () => {
  const ids = Array.from({ length: 100 }, (_, index) => `tab-${index}`);
  let hot: string[] = [];
  for (const id of ids) {
    hot = selectHotViews(hot, ids, id);
    expect(hot).toContain(id);
    expect(hot.length).toBeLessThanOrEqual(12);
  }
  expect(selectHotViews(hot, ["tab-0"], "tab-0")).toEqual(["tab-0"]);
});

it("keeps an unfinished operation hot while one hundred other tabs are visited", () => {
  const ids = ["transaction", ...Array.from({ length: 100 }, (_, index) => `tab-${index}`)];
  let hot = ["transaction"];
  for (const id of ids) {
    hot = selectHotViews(hot, ids, id, ["transaction"]);
    expect(hot).toContain("transaction");
    expect(hot).toContain(id);
    expect(hot.length).toBeLessThanOrEqual(12);
  }
  expect(selectHotViews(hot, ["tab-99"], "tab-99", ["transaction"])).toEqual(["tab-99"]);
});

it("keeps admitted transactions and rejects impossible protected cache state", () => {
  const ids = Array.from({ length: 12 }, (_, index) => `transaction-${index}`);
  expect(selectHotViews(ids, ids, ids[11], ids)).toEqual(ids);
  expect(selectHotViews(ids, [...ids, "idle"], ids[11], ids)).not.toContain("idle");
  expect(() => selectHotViews(ids, [...ids, "active"], "active", ids)).toThrow("resource.limit");
});
