/**
 * 真实文档行 (Real Line) 与界面折叠后可视行 (Visible Line) 双向极速映射表
 */

export interface FoldRange {
  startLine: number; // 折叠起始行 (保留可见)
  endLine: number; // 折叠结束行 (被隐藏范围为 startLine + 1 到 endLine)
}

export class FoldingLineMap {
  private hiddenRealLines = new Set<number>();
  private realToVisible = new Map<number, number>();
  private visibleToReal: number[] = [];

  constructor(totalLines: number, foldedRanges: FoldRange[]) {
    this.rebuild(totalLines, foldedRanges);
  }

  public rebuild(totalLines: number, foldedRanges: FoldRange[]): void {
    this.hiddenRealLines.clear();
    this.realToVisible.clear();
    this.visibleToReal = [];

    // 收集所有被折叠隐藏的行号
    for (const range of foldedRanges) {
      for (let l = range.startLine + 1; l <= range.endLine; l++) {
        this.hiddenRealLines.add(l);
      }
    }

    let visibleIndex = 0;
    for (let real = 0; real < totalLines; real++) {
      if (!this.hiddenRealLines.has(real)) {
        this.realToVisible.set(real, visibleIndex);
        this.visibleToReal.push(real);
        visibleIndex++;
      }
    }
  }

  /** 获取折叠后总可视行数 */
  public get visibleLineCount(): number {
    return this.visibleToReal.length;
  }

  /** 判断真实行是否被隐藏在折叠块中 */
  public isLineHidden(realLine: number): boolean {
    return this.hiddenRealLines.has(realLine);
  }

  /** 真实行号转可视行号 (若被隐藏则返回其所属折叠头的可视行) */
  public getVisibleLine(realLine: number): number {
    const direct = this.realToVisible.get(realLine);
    if (direct !== undefined) return direct;

    // 若被隐藏，向下回溯找到最近的未被隐藏行
    for (let r = realLine - 1; r >= 0; r--) {
      const vis = this.realToVisible.get(r);
      if (vis !== undefined) return vis;
    }
    return 0;
  }

  /** 可视行号转真实行号 */
  public getRealLine(visibleLine: number): number {
    if (visibleLine < 0) return 0;
    if (visibleLine >= this.visibleToReal.length) {
      return this.visibleToReal[this.visibleToReal.length - 1] ?? 0;
    }
    return this.visibleToReal[visibleLine];
  }
}
