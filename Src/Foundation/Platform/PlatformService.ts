import { type PlatformInfo, PlatformIPC } from "../IPC/PlatformCommands";

export type DesktopPlatform = "windows" | "macos" | "linux";

const fallbackPlatform = (): DesktopPlatform => {
  const value = navigator.platform.toLowerCase();
  if (value.includes("mac")) return "macos";
  if (value.includes("linux")) return "linux";
  return "windows";
};

let currentInfo: PlatformInfo = {
  operatingSystem: fallbackPlatform(),
  architecture: "unknown",
  family: "unknown",
  defaultShell: null,
  desktopSession: null,
  pathRestored: false,
};

export const PlatformService = {
  async initialize(): Promise<PlatformInfo> {
    currentInfo = await PlatformIPC.info();
    document.documentElement.dataset.platform = this.current();
    if (currentInfo.desktopSession) {
      document.documentElement.dataset.desktopSession = currentInfo.desktopSession;
    }
    return currentInfo;
  },

  info(): Readonly<PlatformInfo> {
    return currentInfo;
  },

  current(): DesktopPlatform {
    if (currentInfo.operatingSystem === "macos") return "macos";
    if (currentInfo.operatingSystem === "linux") return "linux";
    return "windows";
  },

  isMacOS(): boolean {
    return this.current() === "macos";
  },
};
