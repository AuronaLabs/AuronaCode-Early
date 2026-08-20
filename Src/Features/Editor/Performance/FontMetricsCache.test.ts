import { beforeEach, describe, expect, it } from "vitest";
import { FontMetricsCache } from "./FontMetricsCache";

describe("FontMetricsCache", () => {
  let cache: FontMetricsCache;

  beforeEach(() => {
    cache = FontMetricsCache.getInstance();
    cache.clear();
  });

  it("warmup initializes ASCII table and measures ASCII text accurately", () => {
    const mockMeasure = (char: string) => {
      if (char === "M" || char === "a" || char === "0") return 8.4;
      return 8.4;
    };

    const text = "const x = 100;";
    const width = cache.measureTextFast(text, "JetBrains Mono", 14, mockMeasure);

    expect(width).toBeCloseTo(text.length * 8.4, 2);
  });

  it("handles non-ASCII and CJK unicode characters with caching", () => {
    const mockMeasure = (char: string) => {
      // 假设 CJK 汉字宽度是 16px，ASCII 是 8px
      return char.charCodeAt(0) > 127 ? 16 : 8;
    };

    const text = "console.log('你好世界');";
    // 17 个 ASCII (17 * 8 = 136) + 4 个中文 (4 * 16 = 64) = 200
    const width = cache.measureTextFast(text, "JetBrains Mono", 14, mockMeasure);

    expect(width).toBe(192);
  });

  it("charIndexAtXFast calculates the correct cursor offset accurately", () => {
    const mockMeasure = () => 10; // 每个字符 10px

    const text = "abcdefghij"; // 10 个字符

    // 0px 点击在开头
    expect(cache.charIndexAtXFast(text, 0, "monospace", 14, mockMeasure)).toBe(0);
    // 14px 点击在 'b' 的前半段 (10 + 4 < 15) -> 索引 1
    expect(cache.charIndexAtXFast(text, 14, "monospace", 14, mockMeasure)).toBe(1);
    // 16px 点击在 'b' 的后半段 (10 + 6 >= 15) -> 索引 2
    expect(cache.charIndexAtXFast(text, 16, "monospace", 14, mockMeasure)).toBe(2);
    // 100px 超过文本末尾 -> 索引 10
    expect(cache.charIndexAtXFast(text, 120, "monospace", 14, mockMeasure)).toBe(10);
  });
});
