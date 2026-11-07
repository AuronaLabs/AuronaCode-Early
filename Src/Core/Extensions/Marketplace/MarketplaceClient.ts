import { desktopAvailable } from "../../../Foundation/Desktop";
import { AccountAuthIPC } from "../../../Foundation/IPC/AccountAuthCommands";
import { NetworkIPC } from "../../../Foundation/IPC/NetworkCommands";
import { isOfficialMarketplaceHost } from "./MarketplaceModel";

let cachedMarketplaceToken: string | null = null;
let cachedAuronaAccessToken: string | null = null;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const externalSignal = init.signal;
  if (externalSignal?.aborted) {
    throw externalSignal.reason ?? new DOMException("The request was aborted", "AbortError");
  }
  const controller = new AbortController();
  const native = desktopAvailable();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    native ? Math.max(timeoutMs, 65000) : timeoutMs,
  );
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    if (native) {
      const requestId = crypto.randomUUID();
      const cancel = () => {
        void NetworkIPC.cancelMarketplaceRequest(requestId).catch(() => undefined);
      };
      controller.signal.addEventListener("abort", cancel, { once: true });
      try {
        const response = await NetworkIPC.marketplaceRequest({
          requestId,
          url: String(input),
          method: init.method ?? "GET",
          body: typeof init.body === "string" ? init.body : null,
          headers: Object.fromEntries(new Headers(init.headers).entries()),
        });
        if (controller.signal.aborted)
          throw new DOMException("The request was aborted", "AbortError");
        return new Response(response.body, {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
            "X-Aurona-Catalog-Verified": String(response.catalog_verified === true),
          },
        });
      } finally {
        controller.signal.removeEventListener("abort", cancel);
      }
    }
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}

export async function requestCandidateUrls<T>(
  serverUrl: string,
  relativePath: string,
  options?: RequestInit,
): Promise<{ data: T; url: string } | null> {
  const cleanBase = serverUrl.trim().replace(/\/+$/, "");
  const cleanPath = relativePath.replace(/^\/+/, "");
  const candidateUrls: string[] = [];

  if (cleanBase.endsWith("/api") || cleanBase.includes("/api/")) {
    candidateUrls.push(`${cleanBase}/${cleanPath}`);
  } else {
    candidateUrls.push(`${cleanBase}/api/${cleanPath}`);
  }

  for (const urlStr of candidateUrls) {
    try {
      const res = await fetchWithTimeout(
        urlStr,
        {
          cache: "no-store",
          ...options,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(options?.headers || {}),
          },
        },
        3000,
      );

      if (res.ok) {
        const json = await res.json();
        return { data: json, url: urlStr };
      }
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      // 静默处理网络不可达
    }
  }

  return null;
}

export async function marketplaceAuthHeaders(serverUrl: string): Promise<Record<string, string>> {
  if (!isOfficialMarketplaceHost(serverUrl)) return {};
  let accessToken: string | null = null;
  try {
    const status = await AccountAuthIPC.status();
    if (
      status.phase === "signedIn" &&
      status.expiresAtUnix !== null &&
      status.expiresAtUnix <= Math.floor(Date.now() / 1000) + 30
    ) {
      await AccountAuthIPC.refresh();
    }
    accessToken = await AccountAuthIPC.accessToken();
  } catch {
    return {};
  }
  if (!accessToken) {
    cachedAuronaAccessToken = null;
    cachedMarketplaceToken = null;
    return {};
  }
  if (cachedMarketplaceToken && cachedAuronaAccessToken === accessToken) {
    return { Authorization: `Bearer ${cachedMarketplaceToken}` };
  }
  const exchanged = await requestCandidateUrls<{
    success: boolean;
    token?: string;
  }>(serverUrl, "auth/token-exchange", {
    method: "POST",
    body: JSON.stringify({ access_token: accessToken }),
  });
  if (!exchanged?.data?.success || !exchanged.data.token) return {};
  cachedAuronaAccessToken = accessToken;
  cachedMarketplaceToken = exchanged.data.token;
  return { Authorization: `Bearer ${exchanged.data.token}` };
}
