import { AccountAuthIPC, type AccountAuthStatus } from "../Foundation/IPC/AccountAuthCommands";

const POLL_INTERVAL_MS = 350;
const AUTHORIZATION_TIMEOUT_MS = 305_000;

const INITIAL_STATUS: AccountAuthStatus = {
  enabled: false,
  registeredRedirectUri: "http://127.0.0.1/oauth/callback",
  providerIssuer: "https://auth.aurona.cc",
  discoveryUrl: "https://auth.aurona.cc/.well-known/openid-configuration",
  phase: "disabled",
  profile: null,
  expiresAtUnix: null,
  lastError: null,
  lastNotice: null,
};

type AccountListener = () => void;

let snapshot = INITIAL_STATUS;
let operation: Promise<AccountAuthStatus> | null = null;
let generation = 0;
const listeners = new Set<AccountListener>();

function publish(status: AccountAuthStatus): AccountAuthStatus {
  snapshot = status;
  for (const listener of listeners) listener();
  return status;
}

function isPending(status: AccountAuthStatus): boolean {
  return ["discovering", "awaitingCallback", "exchangingCode", "refreshing"].includes(status.phase);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function readStatus(): Promise<AccountAuthStatus> {
  return publish(await AccountAuthIPC.status());
}

async function waitForAuthorization(operationGeneration: number): Promise<AccountAuthStatus> {
  const deadline = Date.now() + AUTHORIZATION_TIMEOUT_MS;
  while (operationGeneration === generation && Date.now() < deadline) {
    const status = await readStatus();
    if (!isPending(status)) return status;
    await delay(POLL_INTERVAL_MS);
  }
  return readStatus();
}

export const AccountService = {
  getSnapshot: (): AccountAuthStatus => snapshot,

  subscribe: (listener: AccountListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async initialize(): Promise<AccountAuthStatus> {
    try {
      return publish(await AccountAuthIPC.restore());
    } catch {
      return readStatus().catch(() => snapshot);
    }
  },

  refreshStatus(): Promise<AccountAuthStatus> {
    return readStatus();
  },

  login(): Promise<AccountAuthStatus> {
    if (operation) return operation;
    const operationGeneration = ++generation;
    operation = (async () => {
      try {
        await AccountAuthIPC.start();
        await readStatus();
        return await waitForAuthorization(operationGeneration);
      } catch (error) {
        await readStatus().catch(() => undefined);
        throw error;
      } finally {
        operation = null;
      }
    })();
    return operation;
  },

  async cancelLogin(): Promise<AccountAuthStatus> {
    generation += 1;
    await AccountAuthIPC.cancel();
    return readStatus();
  },

  async refresh(): Promise<AccountAuthStatus> {
    return publish(await AccountAuthIPC.refresh());
  },

  async logout(): Promise<AccountAuthStatus> {
    generation += 1;
    await AccountAuthIPC.logout();
    return readStatus();
  },

  async shutdown(): Promise<void> {
    generation += 1;
    await AccountAuthIPC.shutdown();
  },
};
