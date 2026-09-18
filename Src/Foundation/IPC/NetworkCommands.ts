import { invokeDesktop } from "../Desktop";

export interface HttpFetchBytesResult {
  data_b64: string;
  sha256?: string | null;
}

export const NetworkIPC = {
  /** 同步代理偏好到 Rust 全局状态（工具链下载使用） */
  setNetworkProxy: (mode: "system" | "custom" | "none", url?: string) =>
    invokeDesktop<void>("set_network_proxy", { mode, url }),
  /** 走 Rust HTTP 客户端抓取字节（自动携带代理偏好，200MB 体积上限） */
  fetchBytes: (url: string) => invokeDesktop<HttpFetchBytesResult>("http_fetch_bytes", { url }),
};
