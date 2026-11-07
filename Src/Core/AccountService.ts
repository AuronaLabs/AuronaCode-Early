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

async function readStatus(epoch = generation, isCurrent = () => true): Promise<AccountAuthStatus> {
  const status = await AccountAuthIPC.status();
  return epoch === generation && isCurrent() ? publish(status) : snapshot;
}

async function waitForAuthorization(operationGeneration: number): Promise<AccountAuthStatus> {
  const deadline = Date.now() + AUTHORIZATION_TIMEOUT_MS;
  while (operationGeneration === generation && Date.now() < deadline) {
    const status = await readStatus(operationGeneration);
    if (!isPending(status)) return status;
    await delay(POLL_INTERVAL_MS);
  }
  return operationGeneration === generation ? readStatus(operationGeneration) : snapshot;
}

export const AccountService = {
  getSnapshot: (): AccountAuthStatus => snapshot,

  subscribe: (listener: AccountListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async initialize(isCurrent = () => true): Promise<AccountAuthStatus> {
    const epoch = generation;
    try {
      const status = await AccountAuthIPC.restore();
      return epoch === generation && isCurrent() ? publish(status) : snapshot;
    } catch {
      if (epoch !== generation || !isCurrent()) return snapshot;
      return readStatus(epoch, isCurrent).catch(() => snapshot);
    }
  },

  refreshStatus(): Promise<AccountAuthStatus> {
    return readStatus();
  },

  login(): Promise<AccountAuthStatus> {
    if (operation) return operation;
    const operationGeneration = ++generation;
    const request = (async () => {
      try {
        await AccountAuthIPC.start();
        if (operationGeneration !== generation) return snapshot;
        await readStatus(operationGeneration);
        return await waitForAuthorization(operationGeneration);
      } catch (error) {
        if (operationGeneration === generation)
          await readStatus(operationGeneration).catch(() => undefined);
        throw error;
      } finally {
        if (operationGeneration === generation) operation = null;
      }
    })();
    operation = request;
    return operation;
  },

  async cancelLogin(): Promise<AccountAuthStatus> {
    const epoch = ++generation;
    operation = null;
    await AccountAuthIPC.cancel();
    return readStatus(epoch);
  },

  async refresh(): Promise<AccountAuthStatus> {
    const epoch = generation;
    const status = await AccountAuthIPC.refresh();
    return epoch === generation ? publish(status) : snapshot;
  },

  async logout(): Promise<AccountAuthStatus> {
    const epoch = ++generation;
    operation = null;
    await AccountAuthIPC.logout();
    return readStatus(epoch);
  },

  async shutdown(): Promise<void> {
    generation += 1;
    operation = null;
    await AccountAuthIPC.shutdown();
  },
};
