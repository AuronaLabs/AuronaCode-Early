import { getVersion } from "@tauri-apps/api/app";
import { appLogDir, join } from "@tauri-apps/api/path";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";

/** 显示器可用区域（工作区，物理像素）的纯数据投影，供 Desktop 之外消费 */
export interface MonitorArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const currentWindow = getCurrentWindow();

export const desktopApp = {
  getVersion,
  relaunch,
  async errorLogDirectory(): Promise<string> {
    return join(await appLogDir(), "errlogs");
  },
  async logFilePath(): Promise<string> {
    return join(await appLogDir(), "app.log");
  },
};

export const desktopWindow = {
  isMaximized: () => currentWindow.isMaximized(),
  isMinimized: () => currentWindow.isMinimized(),
  onResized: (handler: () => void | Promise<void>) => currentWindow.onResized(handler),
  onCloseRequested: (handler: Parameters<typeof currentWindow.onCloseRequested>[0]) =>
    currentWindow.onCloseRequested(handler),
  maximize: () => currentWindow.maximize(),
  unmaximize: () => currentWindow.unmaximize(),
  minimize: () => currentWindow.minimize(),
  close: () => currentWindow.close(),
  destroy: () => currentWindow.destroy(),
  hide: () => currentWindow.hide(),
  show: () => currentWindow.show(),
  outerSize: () => currentWindow.outerSize(),
  outerPosition: () => currentWindow.outerPosition(),
  setSize: (size: Parameters<typeof currentWindow.setSize>[0]) => currentWindow.setSize(size),
  setPosition: (position: Parameters<typeof currentWindow.setPosition>[0]) =>
    currentWindow.setPosition(position),
  /** 以物理像素设置窗口外框位置（避免调用方直接依赖 Tauri 类型） */
  setPositionPhysical: (x: number, y: number) =>
    currentWindow.setPosition(new PhysicalPosition(x, y)),
  setSizePhysical: (width: number, height: number) =>
    currentWindow.setSize(new PhysicalSize(width, height)),
  /** 全部显示器的可用工作区（物理像素） */
  availableMonitorAreas: async (): Promise<MonitorArea[]> =>
    (await availableMonitors()).map((monitor) => ({
      x: monitor.workArea.position.x,
      y: monitor.workArea.position.y,
      width: monitor.workArea.size.width,
      height: monitor.workArea.size.height,
    })),
  createSplash(): void {
    new WebviewWindow("splashscreen", {
      url: "/splash.html",
      title: "Aurona Code Initializing",
      width: 500,
      height: 300,
      decorations: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      center: true,
      skipTaskbar: true,
    });
  },
};
