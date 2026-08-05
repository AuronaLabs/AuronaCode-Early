import { invokeDesktop } from "../Desktop";

export interface PlatformInfo {
  operatingSystem: "windows" | "macos" | "linux" | string;
  architecture: string;
  family: string;
  defaultShell: string | null;
  desktopSession: "wayland" | "x11" | null;
  pathRestored: boolean;
}

export const PlatformIPC = {
  info: () => invokeDesktop<PlatformInfo>("platform_info"),
};
