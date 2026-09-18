import { desktopWindow } from "../Foundation/Desktop";
import { Logger } from "../Foundation/Logger";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import type { WindowStatePreferences } from "../Foundation/Types/Config";

/** 边界钳制的可见余量：保证窗口在虚拟桌面内至少露出这么多像素，避免整窗丢失在屏外 */
const VISIBLE_MARGIN = 120;

const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

export interface MonitorArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowRectInput {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface RestoredRect {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * 纯函数：普通布局的屏幕边界钳制。拔掉显示器后不至于整窗丢失；
 * 无显示器信息返回 null（调用方回退最大化）。最小尺寸钳 800×600。
 */
export function computeRestoredRect(
  state: WindowRectInput,
  areas: MonitorArea[],
): RestoredRect | null {
  if (!areas.length) return null;
  if (!state.width || !state.height) return null;

  const maxX = areas.reduce((acc, area) => Math.max(acc, area.width), 0);
  const maxY = areas.reduce((acc, area) => Math.max(acc, area.height), 0);
  const restoredWidth = clamp(state.width, MIN_WIDTH, maxX);
  const restoredHeight = clamp(state.height, MIN_HEIGHT, maxY);

  const unionMinX = areas.reduce((acc, area) => Math.min(acc, area.x), Number.POSITIVE_INFINITY);
  const unionMaxX = areas.reduce(
    (acc, area) => Math.max(acc, area.x + area.width),
    Number.NEGATIVE_INFINITY,
  );
  const unionMinY = areas.reduce((acc, area) => Math.min(acc, area.y), Number.POSITIVE_INFINITY);
  const unionMaxY = areas.reduce(
    (acc, area) => Math.max(acc, area.y + area.height),
    Number.NEGATIVE_INFINITY,
  );
  const restoredX =
    state.x === undefined
      ? undefined
      : clamp(state.x, unionMinX - (restoredWidth - VISIBLE_MARGIN), unionMaxX - VISIBLE_MARGIN);
  const restoredY =
    state.y === undefined
      ? undefined
      : clamp(state.y, unionMinY - (restoredHeight - VISIBLE_MARGIN), unionMaxY - VISIBLE_MARGIN);

  return { width: restoredWidth, height: restoredHeight, x: restoredX, y: restoredY };
}

/**
 * 保存主窗口布局到 user-config.json：物理像素 + 是否最大化。
 * 最小化中的窗口 outerPosition 不可靠（Windows 会给 -32000），保留上次有效状态。
 */
export async function saveWindowLayout(): Promise<void> {
  try {
    if (await desktopWindow.isMinimized()) return;
    const [isMaximized, size, position] = await Promise.all([
      desktopWindow.isMaximized(),
      desktopWindow.outerSize(),
      desktopWindow.outerPosition(),
    ]);
    UserConfigStore.set({
      windowState: {
        isMaximized,
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
      },
    });
    await UserConfigStore.flush();
  } catch (error) {
    Logger.warn("Unable to save window layout", error);
  }
}

/**
 * 启动时恢复窗口布局（VSCode 同款）：最大化直恢复；普通布局做屏幕边界钳制，
 * 拔掉显示器后不至于整窗丢失；无显示器信息等异常一律回退最大化。
 */
export async function restoreWindowLayout(state: WindowStatePreferences): Promise<void> {
  try {
    if (state.isMaximized) {
      await desktopWindow.maximize();
      return;
    }
    const { width, height, x, y } = state;
    if (!width || !height) return;

    const areas = await desktopWindow.availableMonitorAreas();
    const rect = computeRestoredRect({ width, height, x, y }, areas);
    if (!rect) {
      await desktopWindow.maximize();
      return;
    }

    if (rect.x !== undefined && rect.y !== undefined) {
      await desktopWindow.setPositionPhysical(rect.x, rect.y);
    }
    await desktopWindow.setSizePhysical(rect.width, rect.height);
  } catch (error) {
    Logger.warn("Unable to restore window layout; falling back to maximized", error);
    await desktopWindow.maximize().catch(() => undefined);
  }
}
