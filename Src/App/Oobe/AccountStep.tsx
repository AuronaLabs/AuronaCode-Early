import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AccountService } from "../../Core/AccountService";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import type { AccountAuthPhase } from "../../Foundation/IPC/AccountAuthCommands";
import { AccountAvatar } from "../../UI/Components/AccountAvatar";
import { Button } from "../../UI/Components/Button";
import { Icons } from "../../UI/Icons/IconManager";

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

/**
 * 步骤四：Aurona 账户登录（可跳过）。与设置页共用 AccountService 登录流程，
 * 授权在系统浏览器完成；「暂不登录」或底部「下一步」均可跳过。
 */
export function AccountStep({ onSkip }: { onSkip: () => void }) {
  const { t } = useLocale();
  const status = useSyncExternalStore(
    AccountService.subscribe,
    () => AccountService.getSnapshot(),
    () => AccountService.getSnapshot(),
  );
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const pending = isOperating || PENDING_PHASES.includes(status.phase);
  const profile = status.profile;
  const signedIn = profile !== null && status.phase === "signedIn";
  const displayName = useMemo(
    () => profile?.preferredUsername || profile?.name || t("account.defaultDisplayName"),
    [profile, t],
  );

  // 兜底拉取最新账户状态：HMR 或初始化时序可能让共享快照停留在初始 disabled 态，
  // 导致登录按钮不渲染（表现为"点击没反应"）
  useEffect(() => {
    void AccountService.refreshStatus().catch(() => undefined);
  }, []);

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

  const errorMessage = interactionError ?? status.lastError?.userMessage ?? null;

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[26px] font-bold tracking-tight text-[var(--color-text-highlight)]">
          {t("oobe.accountTitle")}
        </h1>
        <p className="max-w-[430px] text-[13.5px] leading-6 text-[var(--color-text-muted)]">
          {t("oobe.accountDesc")}
        </p>
      </div>

      {signedIn ? (
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute -inset-2.5 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_26%,transparent),transparent_72%)]"
            />
            <AccountAvatar
              key={profile.picture}
              name={displayName}
              picture={profile.picture}
              className="relative ring-2 ring-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
            />
            <span className="absolute right-1 bottom-1 grid size-6 place-items-center rounded-full border-2 border-[var(--AppBg,var(--AppBg))] bg-[var(--StatusSuccess)] text-white shadow-sm">
              <Icons.Check size={12} stroke={3} />
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[17px] font-semibold text-[var(--color-text-highlight)]">
              {displayName}
            </p>
            {profile.email && (
              <p className="text-[12.5px] text-[var(--color-text-muted)]">{profile.email}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <div className="oobe-logo-halo" />
            <div className="relative grid size-[72px] place-items-center rounded-[22px] border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-accent)] shadow-[0_12px_36px_rgb(0_0_0/22%)]">
              <Icons.User size={34} stroke={1.5} />
            </div>
          </div>

          {status.enabled ? (
            pending ? (
              <div className="flex flex-col items-center gap-3.5">
                <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-primary)]">
                  <Icons.Refresh size={15} className="animate-spin" />
                  {phaseMessage(t, status.phase) || t("account.preparingLogin")}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void cancel()}>
                  {t("account.cancelLogin")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2.5">
                <Button size="lg" className="min-w-[220px]" onClick={() => void login()}>
                  <Icons.Login size={16} />
                  {t("account.login")}
                </Button>
                <Button variant="ghost" size="sm" onClick={onSkip}>
                  {t("oobe.accountSkip")}
                </Button>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center gap-2.5">
              <p className="rounded-surface bg-[var(--material-panel)] px-4 py-2.5 text-[12px] text-[var(--color-text-muted)]">
                {t("account.notConfigured")}
              </p>
              <Button variant="ghost" size="sm" onClick={onSkip}>
                {t("oobe.accountSkip")}
              </Button>
            </div>
          )}

          <p className="max-w-[380px] text-[11px] leading-5 text-[var(--color-text-muted)]/80">
            {t("oobe.accountHint")}
          </p>

          {errorMessage && status.phase !== "signedIn" && (
            <div
              role="alert"
              className="max-w-[420px] rounded-surface border border-[var(--StatusError)]/15 bg-[var(--StatusError)]/5 px-4 py-2.5 text-[12px] leading-5 text-[var(--StatusError)]"
            >
              {errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
