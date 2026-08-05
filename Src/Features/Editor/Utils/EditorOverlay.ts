export interface EditorOverlayAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface EditorOverlayPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}

export function editorPointToViewport(
  container: { left: number; top: number },
  point: { x: number; y: number },
  scroll: { left: number; top: number },
) {
  return {
    x: container.left + point.x - scroll.left,
    y: container.top + point.y - scroll.top,
  };
}

export function positionEditorOverlay(
  anchor: EditorOverlayAnchor,
  overlay: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 6,
): EditorOverlayPosition {
  const maxLeft = Math.max(margin, viewport.width - overlay.width - margin);
  const left = Math.max(margin, Math.min(anchor.left, maxLeft));
  const roomBelow = viewport.height - anchor.bottom - margin;
  const roomAbove = anchor.top - margin;
  const placement = roomBelow >= overlay.height || roomBelow >= roomAbove ? "below" : "above";
  const preferredTop =
    placement === "below" ? anchor.bottom + gap : anchor.top - overlay.height - gap;
  const maxTop = Math.max(margin, viewport.height - overlay.height - margin);
  return {
    left,
    top: Math.max(margin, Math.min(preferredTop, maxTop)),
    placement,
  };
}
