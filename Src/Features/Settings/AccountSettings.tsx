import { useMemo, useState, useSyncExternalStore } from "react";
import { AccountService } from "../../Core/AccountService";
import type { AccountAuthPhase } from "../../Foundation/IPC/AccountAuthCommands";
import { Button } from "../../UI/Components/Button";
import { Icons } from "../../UI/Icons/IconManager";

const PENDING_PHASES: AccountAuthPhase[] = [
  "discovering",
  "awaitingCallback",
  "exchangingCode",
  "refreshing",
];

function phaseMessage(phase: AccountAuthPhase): string {
  switch (phase) {
    case "discovering":
      return "正在连接 Aurona Account…";
    case "awaitingCallback":
      return "请在系统浏览器中完成授权";
    case "exchangingCode":
      return "正在安全验证账户…";
    case "refreshing":
      return "正在恢复账户登录…";
    default:
      return "";
  }
}

function profileInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "A";
}

function AccountAvatar({ name, picture }: { name: string; picture: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="mb-7 grid size-28 place-items-center overflow-hidden rounded-full border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Elevated)] text-4xl font-semibold text-[var(--AccentPrimary)] shadow-[var(--shadow-surface)]">
      {picture && !failed ? (
        <img
          src={picture}
          alt={`${name} 的头像`}
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{profileInitial(name)}</span>
      )}
    </div>
  );
}

export function AccountSettings() {
  const status = useSyncExternalStore(
    AccountService.subscribe,
    AccountService.getSnapshot,
    AccountService.getSnapshot,
  );
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const pending = isOperating || PENDING_PHASES.includes(status.phase);
  const profile = status.profile;
  const displayName = useMemo(
    () => profile?.preferredUsername || profile?.name || "Aurona 用户",
    [profile],
  );

  const login = async () => {
    setInteractionError(null);
    setIsOperating(true);
    try {
      const result = await AccountService.login();
      if (result.phase === "failed") {
        setInteractionError(result.lastError?.userMessage ?? "登录未能完成，请重试。");
      }
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : "登录未能完成，请重试。");
    } finally {
      setIsOperating(false);
    }
  };

  const cancel = async () => {
    setInteractionError(null);
    try {
      await AccountService.cancelLogin();
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : "无法取消登录，请稍后重试。");
    }
  };

  const logout = async () => {
    setInteractionError(null);
    setIsOperating(true);
    try {
      await AccountService.logout();
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : "退出登录失败，请稍后重试。");
    } finally {
      setIsOperating(false);
    }
  };

  return (
    <div className="flex min-h-[520px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl glass-inner-card shadow-sm">
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
        {profile && status.phase === "signedIn" ? (
          <>
            <AccountAvatar key={profile.picture} name={displayName} picture={profile.picture} />
            <h2 className="max-w-full break-words text-3xl font-bold tracking-tight text-[var(--TextHighlight)]">
              {displayName}
            </h2>
            <p className="mt-2 max-w-lg break-all text-[11px] tracking-wide text-[var(--TextMuted)]">
              ID · {profile.subject}
            </p>
            <p className="mt-7 max-w-full break-all text-xl font-medium text-[var(--TextPrimary)]">
              {profile.email || "未向 Aurona Code 授权邮箱"}
            </p>
            {profile.emailVerified === false && profile.email && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">邮箱尚未验证</p>
            )}
          </>
        ) : (
          <>
            <div className="mb-7 grid size-20 place-items-center rounded-3xl border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Elevated)] text-[var(--AccentPrimary)] shadow-[var(--shadow-surface)]">
              <Icons.User size={36} stroke={1.5} />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-[var(--TextHighlight)]">
              Aurona Account
            </h2>
            <p className="mt-3 max-w-md text-[13px] leading-6 text-[var(--TextMuted)]">
              使用 Aurona 官方账户连接 Aurona
              Code。授权会在系统浏览器中完成，应用不会读取或保存你的密码。
            </p>
            {status.enabled ? (
              pending ? (
                <div className="mt-8 flex flex-col items-center gap-4">
                  <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--TextPrimary)]">
                    <Icons.Refresh size={16} className="animate-spin" />
                    {phaseMessage(status.phase) || "正在准备登录…"}
                  </span>
                  <Button variant="ghost" onClick={() => void cancel()}>
                    取消登录
                  </Button>
                </div>
              ) : (
                <Button className="mt-8" size="lg" onClick={() => void login()}>
                  <Icons.Login size={18} />
                  登录 Aurona Account
                </Button>
              )
            ) : (
              <p className="mt-8 rounded-xl bg-[var(--GlassSurface-Base)] px-4 py-3 text-[12px] text-[var(--TextMuted)]">
                当前构建尚未配置 Aurona Account 客户端。
              </p>
            )}
          </>
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
            <p className="mt-6 text-[12px] text-[var(--TextMuted)]" role="status">
              {status.lastNotice}
            </p>
          )}
      </div>

      {profile && status.phase === "signedIn" && (
        <div className="border-t border-[var(--GlassBorder)] p-5">
          <Button
            variant="secondary"
            fullWidth
            disabled={isOperating}
            className="text-red-600 dark:text-red-400"
            onClick={() => void logout()}
          >
            <Icons.Logout size={17} />
            {isOperating ? "正在退出…" : "退出登录"}
          </Button>
        </div>
      )}
    </div>
  );
}
