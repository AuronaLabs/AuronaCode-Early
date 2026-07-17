import { getVersion } from "@tauri-apps/api/app";
import { appLogDir, join } from "@tauri-apps/api/path";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";

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
