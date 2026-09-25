import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { Button } from "../../UI/Components/Button";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";

/** "workspace.read" → "workspaceRead"（对应 locale 中 extensions.permission.* 的段名） */
export function permissionSegment(permission: string): string {
  return permission
    .split(".")
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

export type PermissionResolveMode = "once" | "workspace" | "global" | "deny";

interface ExtensionPermissionPromptProps {
  /** 请求授权的权限 id（如 "workspace.read" / "editor.current.read"） */
  permission: string;
  /** 扩展展示名（用于标题插值） */
  title: string;
  /** 授权选择回调：once（仅本次）/ workspace（此工作区）/ global（所有工作区）/ deny */
  onResolve: (mode: PermissionResolveMode) => void;
}

/**
 * 通用扩展授权弹窗：任何权限（不限于 editor.current.read）的三选一授权流程。
 * 权限名称与说明文案直接读 locale 的 extensions.permission.<segment>.*。
 * 授权落库由调用方完成（组件只负责选择与展示）。
 */
export function ExtensionPermissionPrompt({
  permission,
  title,
  onResolve,
}: ExtensionPermissionPromptProps) {
  const { t } = useLocale();
  const segment = permissionSegment(permission);
  const permissionName = t(`extensions.permission.${segment}.name` as I18nKey);
  const permissionDescription = t(`extensions.permission.${segment}.description` as I18nKey);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-[var(--glass-blur-base)] transition-all animate-in fade-in duration-200">
      <GlassContainer
        layer="overlay"
        className="relative w-full max-w-[280px] rounded-overlay p-5 shadow-[var(--shadow-overlay)] flex flex-col items-center text-center animate-in zoom-in-95 duration-200"
      >
        {/* 顶部居中极简图标 */}
        <div className="flex size-12 items-center justify-center rounded-control bg-[var(--material-surface)] text-[var(--color-accent)] border border-[var(--border-subtle)] mb-3 shadow-inner">
          <Icons.ShieldCheck size={24} stroke={1.75} />
        </div>

        {/* 居中标题 */}
        <h3 className="text-[14px] font-semibold text-[var(--color-text-highlight)] tracking-tight leading-snug px-1">
          {t("extensions.permissionPromptTitle").replace("{name}", title)}
        </h3>

        {/* 申请的权限 */}
        <span className="mt-2 rounded border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
          {permissionName}
        </span>

        {/* 极简说明 */}
        <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed mt-1.5 mb-4 px-1">
          {permissionDescription}
        </p>

        {/* 三种授权范围 + 拒绝 */}
        <div className="flex w-full flex-col gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => onResolve("once")}
            className="h-8.5 w-full text-[12px] font-semibold rounded-control"
          >
            {t("extensions.permission.scopeOnce")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onResolve("workspace")}
            className="h-8.5 w-full text-[12px] font-medium rounded-control"
          >
            {t("extensions.permission.scopeWorkspace")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onResolve("global")}
            className="h-8.5 w-full text-[12px] font-medium rounded-control"
          >
            {t("extensions.permission.scopeGlobal")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onResolve("deny")}
            className="h-8 w-full text-[12px] text-[var(--color-text-muted)] hover:text-[var(--StatusError)] hover:bg-[var(--StatusError)]/10 rounded-control"
          >
            {t("extensions.deny")}
          </Button>
        </div>
      </GlassContainer>
    </div>
  );
}
