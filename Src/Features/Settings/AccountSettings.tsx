import { useMemo, useState, useSyncExternalStore } from "react";
import { AccountService } from "../../Core/AccountService";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import type { AccountAuthPhase } from "../../Foundation/IPC/AccountAuthCommands";
import { AccountAvatar } from "../../UI/Components/AccountAvatar";
import { Button } from "../../UI/Components/Button";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";

const REQUESTED_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

const PENDING_PHASES: AccountAuthPhase[] = [
  "discovering",
  "awaitingCallback",
  "exchangingCode",
  "refreshing",
];

function phaseMessage(t: (key: I18nKey) => string, phase: AccountAuthPhase): string {
  switch (phase) {
    case "discovering":
      return t("account.connecting");
    case "awaitingCallback":
      return t("account.awaitingCallback");
    case "exchangingCode":
      return t("account.exchangingCode");
    case "refreshing":
      return t("account.restoringSession");
    default:
      return "";
  }
}

export function AccountSettings() {
  const { t } = useLocale();
  const status = useSyncExternalStore(
    AccountService.subscribe,
    AccountService.getSnapshot,
    AccountService.getSnapshot,
  );
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pending = isOperating || PENDING_PHASES.includes(status.phase);
  const profile = status.profile;
  const signedIn = profile !== null && status.phase === "signedIn";
  const displayName = useMemo(
    () => profile?.preferredUsername || profile?.name || t("account.defaultDisplayName"),
    [profile, t],
  );

  const login = async () => {
    setInteractionError(null);
    setIsOperating(true);
    try {
      const result = await AccountService.login();
      if (result.phase === "failed") {
        setInteractionError(result.lastError?.userMessage ?? t("account.loginFailed"));
      }
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : t("account.loginFailed"));
    } finally {
      setIsOperating(false);
    }
  };

  const cancel = async () => {
    setInteractionError(null);
    try {
      await AccountService.cancelLogin();
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : t("account.cancelFailed"));
    }
  };

  const logout = async () => {
    setInteractionError(null);
    setIsOperating(true);
    try {
      await AccountService.logout();
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("account.logoutFailed"), "error");
    } finally {
      setIsOperating(false);
    }
  };

  const refreshProfile = async () => {
    setInteractionError(null);
    setIsRefreshing(true);
    try {
      const result = await AccountService.refresh();
      if (result.phase === "failed") {
        showToast(result.lastError?.userMessage ?? t("account.refreshFailed"), "error");
      } else if (result.phase === "signedIn") {
        showToast(t("account.refreshToast"), "success");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("account.refreshFailed"), "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <GlassContainer
      layer="elevated"
      className="flex min-h-[520px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
    >
      {signedIn ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
          <div className="relative mb-7">
            <AccountAvatar key={profile.picture} name={displayName} picture={profile.picture} />
            <span className="absolute bottom-1.5 right-1.5 grid size-6 place-items-center rounded-full border border-[var(--border-subtle)] bg-emerald-500 text-white shadow-sm">
              <Icons.Check size={13} stroke={3} />
            </span>
          </div>
          <h2 className="max-w-full break-words text-3xl font-bold tracking-tight text-[var(--color-text-highlight)]">
            {displayName}
          </h2>
          <p className="mt-2 max-w-full break-all text-xl font-medium text-[var(--color-text-primary)]">
            {profile.email || t("account.noEmail")}
          </p>

          <p className="mt-4 max-w-lg break-all text-[11px] tracking-wide text-[var(--color-text-muted)]">
            ID · {profile.subject}
          </p>

          <div className="mt-7 flex items-center justify-center gap-3">
            <Button
              variant="secondary"
              disabled={isRefreshing}
              onClick={() => void refreshProfile()}
            >
              <Icons.Refresh size={16} className={isRefreshing ? "animate-spin" : undefined} />
              {isRefreshing ? t("account.refreshing") : t("account.refreshProfile")}
            </Button>
            <Button
              variant="secondary"
              disabled={isOperating}
              className="text-red-600 dark:text-red-400"
              onClick={() => void logout()}
            >
              <Icons.Logout size={17} />
              {isOperating ? t("account.signingOut") : t("account.logout")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
          <div className="mb-7 grid size-20 place-items-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-accent)]">
            <Icons.User size={36} stroke={1.5} />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--color-text-highlight)]">
            Aurona Account
          </h2>
          <p className="mt-3 max-w-md text-[13px] leading-6 text-[var(--color-text-muted)]">
            {t("account.intro")}
          </p>

          <div className="mt-6 flex max-w-md flex-wrap items-center justify-center gap-2">
            {REQUESTED_SCOPES.map((scope) => (
              <span
                key={scope}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-muted)]"
              >
                {scope}
              </span>
            ))}
          </div>
          <p className="mt-2 max-w-md text-[11px] leading-5 text-[var(--color-text-muted)]">
            {t("account.scopesNote")}
          </p>

          {status.enabled ? (
            pending ? (
              <div className="mt-8 flex flex-col items-center gap-4">
                <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-primary)]">
                  <Icons.Refresh size={16} className="animate-spin" />
                  {phaseMessage(t, status.phase) || t("account.preparingLogin")}
                </span>
                <Button variant="ghost" onClick={() => void cancel()}>
                  {t("account.cancelLogin")}
                </Button>
              </div>
            ) : (
              <Button className="mt-8" size="lg" onClick={() => void login()}>
                <Icons.Login size={18} />
                {t("account.login")}
              </Button>
            )
          ) : (
            <p className="mt-8 rounded-xl bg-[var(--material-panel)] px-4 py-3 text-[12px] text-[var(--color-text-muted)]">
              {t("account.notConfigured")}
            </p>
          )}

          {(interactionError || status.lastError?.userMessage) && status.phase !== "signedIn" && (
            <div
              role="alert"
              className="mt-6 max-w-lg rounded-xl border border-red-500/15 bg-red-500/5 px-4 py-3 text-[12px] leading-5 text-red-600 dark:text-red-400"
            >
              {interactionError || status.lastError?.userMessage}
            </div>
          )}
          {status.lastNotice &&
            !interactionError &&
            !status.lastError &&
            status.phase !== "signedIn" && (
              <p className="mt-6 text-[12px] text-[var(--color-text-muted)]" role="status">
                {status.lastNotice}
              </p>
            )}
        </div>
      )}
    </GlassContainer>
  );
}
