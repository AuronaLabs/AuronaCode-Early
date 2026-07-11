export const _measureCanvas = document.createElement("canvas");
export const _measureCtx = _measureCanvas.getContext("2d");
if (_measureCtx) {
  _measureCtx.font = '14px "JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace';
}

export function measureTextWidthFast(text: string): number {
  if (!_measureCtx) return text.length * 8;
  const normalized = text.replace(/\t/g, "  ");
  return _measureCtx.measureText(normalized).width;
}

export function minTextLengthIndex(text: string, relativeX: number): number {
  if (relativeX <= 0) return 0;
  const textForMeasure = text.replace(/\t/g, "  ");
  const totalWidth = measureTextWidthFast(textForMeasure);
  if (relativeX >= totalWidth) return text.length;

  for (let i = 0; i < text.length; i++) {
    const prefix = text.substring(0, i).replace(/\t/g, "  ");
    const nextPrefix = text.substring(0, i + 1).replace(/\t/g, "  ");
    const w1 = measureTextWidthFast(prefix);
    const w2 = measureTextWidthFast(nextPrefix);
    if (relativeX < (w1 + w2) / 2) {
      return i;
    }
  }
  return text.length;
}
