import { invokeDesktop } from "../Desktop";

export const NetworkIPC = {
  /** 同步代理偏好到 Rust 全局状态（工具链下载使用） */
  setNetworkProxy: (mode: "system" | "custom" | "none", url?: string) =>
    invokeDesktop<void>("set_network_proxy", { mode, url }),
};
