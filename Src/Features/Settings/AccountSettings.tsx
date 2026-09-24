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
    () => AccountService.getSnapshot(),
    () => AccountService.getSnapshot(),
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
      layer="raised"
      className="flex min-h-[520px] w-full max-w-3xl flex-col overflow-hidden"
    >
      {signedIn ? (
        <>
          {/* Hero 区：accent 光晕 + 头像光圈 + 身份信息 */}
          <div className="relative overflow-hidden px-8 pb-8 pt-11 text-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,color-mix(in_srgb,var(--color-accent)_13%,transparent),transparent)]"
            />
            <div className="relative flex flex-col items-center">
              <div className="relative mb-6">
                <div
                  aria-hidden="true"
                  className="absolute -inset-2.5 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_24%,transparent),transparent_72%)]"
                />
                <AccountAvatar
                  key={profile.picture}
                  name={displayName}
                  picture={profile.picture}
                  className="relative ring-2 ring-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
                />
                <span className="absolute bottom-1.5 right-1.5 grid size-6 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--StatusSuccess)] text-white shadow-sm">
                  <Icons.Check size={13} stroke={3} />
                </span>
              </div>
              <h2 className="max-w-full break-words text-[22px] font-bold tracking-tight text-[var(--color-text-highlight)]">
                {displayName}
              </h2>
              <p className="mt-1.5 max-w-full break-all text-[13px] font-medium text-[var(--color-text-primary)]">
                {profile.email || t("account.noEmail")}
              </p>
              {profile.preferredUsername && (
                <p className="mt-1 max-w-lg break-all text-[11.5px] font-medium text-[var(--color-text-muted)]">
                  @{profile.preferredUsername}
                </p>
              )}
            </div>
          </div>

          {/* 操作区：行式布局 */}
          <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] px-6 py-5">
            <div className="flex items-center justify-between rounded-[var(--radius-surface)] border border-[var(--border-subtle)] bg-[var(--surface-base)] px-4 py-3">
              <div className="flex items-center gap-2.5 text-[12.5px] text-[var(--color-text-highlight)]">
                <Icons.Refresh size={15} className="text-[var(--color-text-muted)]" />
                {t("account.refreshProfile")}
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={isRefreshing}
                onClick={() => void refreshProfile()}
              >
                {isRefreshing ? t("account.refreshing") : t("account.refreshProfile")}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-surface)] border border-[var(--border-subtle)] bg-[var(--surface-base)] px-4 py-3">
              <div className="flex items-center gap-2.5 text-[12.5px] text-[var(--color-text-highlight)]">
                <Icons.Logout size={15} className="text-[var(--StatusError)]" />
                {t("account.logout")}
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={isOperating}
                className="text-[var(--StatusError)] hover:text-[var(--StatusError)]"
                onClick={() => void logout()}
              >
                {isOperating ? t("account.signingOut") : t("account.logout")}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Hero 区：光晕图标 + 标题 + 简介 */}
          <div className="relative overflow-hidden px-8 pb-8 pt-11 text-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,color-mix(in_srgb,var(--color-accent)_13%,transparent),transparent)]"
            />
            <div className="relative flex flex-col items-center">
              <div className="relative mb-6 grid size-20 place-items-center rounded-[var(--radius-surface)] border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-accent)]">
                <Icons.User size={36} stroke={1.5} />
              </div>
              <h2 className="text-[22px] font-bold tracking-tight text-[var(--color-text-highlight)]">
                Aurona Account
              </h2>
              <p className="mt-2.5 max-w-md text-[13px] leading-6 text-[var(--color-text-muted)]">
                {t("account.intro")}
              </p>
            </div>
          </div>

          {/* 信息与操作区 */}
          <div className="flex flex-1 flex-col items-center gap-4 border-t border-[var(--border-subtle)] px-8 py-6 text-center">
            <div className="flex max-w-md flex-wrap items-center justify-center gap-2">
              {REQUESTED_SCOPES.map((scope) => (
                <span
                  key={scope}
                  className="rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-muted)]"
                >
                  {scope}
                </span>
              ))}
            </div>
            <p className="max-w-md text-[11px] leading-5 text-[var(--color-text-muted)]">
              {t("account.scopesNote")}
            </p>

            <div className="mt-auto flex flex-col items-center gap-4 pt-2">
              {status.enabled ? (
                pending ? (
                  <>
                    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-primary)]">
                      <Icons.Refresh size={16} className="animate-spin" />
                      {phaseMessage(t, status.phase) || t("account.preparingLogin")}
                    </span>
                    <Button variant="ghost" onClick={() => void cancel()}>
                      {t("account.cancelLogin")}
                    </Button>
                  </>
                ) : (
                  <Button size="lg" onClick={() => void login()}>
                    <Icons.Login size={18} />
                    {t("account.login")}
                  </Button>
                )
              ) : (
                <p className="rounded-surface bg-[var(--material-panel)] px-4 py-3 text-[12px] text-[var(--color-text-muted)]">
                  {t("account.notConfigured")}
                </p>
              )}

              {(interactionError || status.lastError?.userMessage) &&
                status.phase !== "signedIn" && (
                  <div
                    role="alert"
                    className="max-w-lg rounded-surface border border-[var(--StatusError)]/15 bg-[var(--StatusError)]/5 px-4 py-3 text-[12px] leading-5 text-[var(--StatusError)]"
                  >
                    {interactionError || status.lastError?.userMessage}
                  </div>
                )}
              {status.lastNotice &&
                !interactionError &&
                !status.lastError &&
                status.phase !== "signedIn" && (
                  <p className="text-[12px] text-[var(--color-text-muted)]" role="status">
                    {status.lastNotice}
                  </p>
                )}
            </div>
          </div>
        </>
      )}
    </GlassContainer>
  );
}
