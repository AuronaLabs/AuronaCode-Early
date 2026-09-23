import { invokeDesktop } from "../Desktop/Transport";

export type AccountAuthPhase =
  | "disabled"
  | "signedOut"
  | "discovering"
  | "awaitingCallback"
  | "exchangingCode"
  | "signedIn"
  | "refreshing"
  | "failed";

export interface AccountAuthError {
  code: string;
  userMessage: string;
  detail: string;
  recoverable: boolean;
}

export interface AccountProfile {
  subject: string;
  name: string | null;
  preferredUsername: string | null;
  email: string | null;
  emailVerified: boolean | null;
  picture: string | null;
}

export interface AccountAuthStatus {
  enabled: boolean;
  registeredRedirectUri: string;
  providerIssuer: string;
  discoveryUrl: string;
  phase: AccountAuthPhase;
  profile: AccountProfile | null;
  expiresAtUnix: number | null;
  lastError: AccountAuthError | null;
  lastNotice: string | null;
}

/**
 * Aurona Account IPC client. Consumed by product UI surfaces
 * (StatusBar / Oobe / AccountSettings) and MarketplaceService.
 */
export const AccountAuthIPC = {
  status(): Promise<AccountAuthStatus> {
    return invokeDesktop("account_auth_status");
  },
  start(): Promise<void> {
    return invokeDesktop("account_auth_start");
  },
  cancel(): Promise<void> {
    return invokeDesktop("account_auth_cancel");
  },
  refresh(): Promise<AccountAuthStatus> {
    return invokeDesktop("account_auth_refresh");
  },
  accessToken(): Promise<string | null> {
    return invokeDesktop("account_auth_access_token");
  },
  restore(): Promise<AccountAuthStatus> {
    return invokeDesktop("account_auth_restore");
  },
  logout(): Promise<void> {
    return invokeDesktop("account_auth_logout");
  },
  shutdown(): Promise<void> {
    return invokeDesktop("account_auth_shutdown");
  },
};
