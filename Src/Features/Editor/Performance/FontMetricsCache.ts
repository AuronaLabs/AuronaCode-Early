/**
 * ASCII 与 CJK 字符宽度定宽快速缓存池
 * 彻底消除长文本渲染与光标移动时的频繁 Canvas measureText 调用。
 */

const ASCII_CHAR_COUNT = 128;

export class FontMetricsCache {
  private static instance: FontMetricsCache | null = null;

  // 每个字体配置对应的 ASCII 0~127 字符宽度快表
  private asciiTables = new Map<string, Float32Array>();
  // 非 ASCII 字符（如中文、特殊符号、Emoji）的 LRU 缓存
  private unicodeCache = new Map<string, number>();
  private maxCacheSize = 2048;

  public static getInstance(): FontMetricsCache {
    if (!FontMetricsCache.instance) {
      FontMetricsCache.instance = new FontMetricsCache();
    }
    return FontMetricsCache.instance;
  }

  /**
   * 生成字体唯一签名 key
   */
  private getFontKey(fontFamily: string, fontSize: number): string {
    return `${fontSize}px ${fontFamily}`;
  }

  /**
   * 预热指定字体的 ASCII 0~127 字符宽度快表
   */
  public warmup(
    fontFamily: string,
    fontSize: number,
    measureFn: (char: string, fontKey: string) => number,
  ): Float32Array {
    const fontKey = this.getFontKey(fontFamily, fontSize);
    let table = this.asciiTables.get(fontKey);
    if (table) return table;

    table = new Float32Array(ASCII_CHAR_COUNT);
    // 基础单字符宽度（针对等宽字体，大部分 ASCII 字符宽度恒定）
    const baseCharWidth = measureFn("M", fontKey) || fontSize * 0.6;

    for (let i = 0; i < ASCII_CHAR_COUNT; i++) {
      const char = String.fromCharCode(i);
      if (i === 9) {
        // Tab 键宽度按 2 个空格算
        table[i] = baseCharWidth * 2;
      } else if (i < 32 || i === 127) {
        // 控制字符宽度为 0
        table[i] = 0;
      } else {
        const measured = measureFn(char, fontKey);
        table[i] = measured > 0 ? measured : baseCharWidth;
      }
    }

    this.asciiTables.set(fontKey, table);
    return table;
  }

  /**
   * 快速测量整行或子串的像素宽度 (O(N) 纯算术查表，无 DOM/Canvas 调用)
   */
  public measureTextFast(
    text: string,
    fontFamily: string,
    fontSize: number,
    measureFallback: (char: string, fontKey: string) => number,
  ): number {
    if (!text) return 0;

    const fontKey = this.getFontKey(fontFamily, fontSize);
    let asciiTable = this.asciiTables.get(fontKey);
    if (!asciiTable) {
      asciiTable = this.warmup(fontFamily, fontSize, measureFallback);
    }

    let totalWidth = 0;
    const len = text.length;

    for (let i = 0; i < len; i++) {
      const code = text.charCodeAt(i);
      if (code < ASCII_CHAR_COUNT) {
        totalWidth += asciiTable[code];
      } else {
        // Unicode / CJK 字符
        const char = text[i];
        const cacheKey = `${fontKey}:${char}`;
        let charWidth = this.unicodeCache.get(cacheKey);

        if (charWidth === undefined) {
          charWidth = measureFallback(char, fontKey);
          if (this.unicodeCache.size >= this.maxCacheSize) {
            // 达到上限时清理前 25% 的旧缓存
            const keysToDelete = Array.from(this.unicodeCache.keys()).slice(
              0,
              Math.floor(this.maxCacheSize * 0.25),
            );
            for (const key of keysToDelete) {
              this.unicodeCache.delete(key);
            }
          }
          this.unicodeCache.set(cacheKey, charWidth);
        }

        totalWidth += charWidth;
      }
    }

    return totalWidth;
  }

  /**
   * 根据 X 轴像素偏移快速反查字符索引
   */
  public charIndexAtXFast(
    text: string,
    targetX: number,
    fontFamily: string,
    fontSize: number,
    measureFallback: (char: string, fontKey: string) => number,
  ): number {
    if (targetX <= 0 || !text) return 0;

    const fontKey = this.getFontKey(fontFamily, fontSize);
    let asciiTable = this.asciiTables.get(fontKey);
    if (!asciiTable) {
      asciiTable = this.warmup(fontFamily, fontSize, measureFallback);
    }

    let accumulatedX = 0;
    const len = text.length;

    for (let i = 0; i < len; i++) {
      const code = text.charCodeAt(i);
      let charWidth: number;

      if (code < ASCII_CHAR_COUNT) {
        charWidth = asciiTable[code];
      } else {
        const char = text[i];
        const cacheKey = `${fontKey}:${char}`;
        charWidth = this.unicodeCache.get(cacheKey) ?? measureFallback(char, fontKey);
      }

      // 如果点击位置在字符的后半部分，则吸附到后一个索引
      if (accumulatedX + charWidth * 0.5 >= targetX) {
        return i;
      }
      accumulatedX += charWidth;
      if (accumulatedX >= targetX) {
        return i + 1;
      }
    }

    return len;
  }

  /**
   * 清除指定或全部字体缓存
   */
  public clear(): void {
    this.asciiTables.clear();
    this.unicodeCache.clear();
  }
}
