import { useLocale } from "../../../Foundation/I18n";
import { Button } from "../../../UI/Components/Button";
import { GlassContainer } from "../../../UI/Core/GlassManager";
import { Icons } from "../../../UI/Icons/IconManager";

export interface DependencyInfo {
  name: string;
  version?: string;
  size?: string;
  type: "runtime" | "extension";
  description: string;
}

/** 安装确认弹窗里展示的声明权限（与市场条目的 PermissionItem 同构） */
export interface DeclaredPermissionInfo {
  name: string;
  description?: string;
  level?: string;
}

interface DependencyConfirmModalProps {
  isOpen: boolean;
  targetName: string;
  targetVersion?: string;
  targetType?: "lsp" | "extension";
  dependencies: DependencyInfo[];
  /** 扩展声明的权限：安装前让用户明确知道它要什么 */
  permissions?: DeclaredPermissionInfo[];
  onConfirm: () => void;
  onCancel: () => void;
}

const LEVEL_KEY: Record<string, string> = {
  normal: "extensions.permission.levelNormal",
  sensitive: "extensions.permission.levelSensitive",
  critical: "extensions.permission.levelCritical",
};

export function DependencyConfirmModal({
  isOpen,
  targetName,
  dependencies,
  permissions = [],
  onConfirm,
  onCancel,
}: DependencyConfirmModalProps) {
  const { t } = useLocale();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 backdrop-blur-[var(--surface-blur-base)]">
      <GlassContainer layer="overlay" className="relative w-full max-w-[360px] p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-subtle)] text-[var(--StatusWarning)]">
            <Icons.Terminal size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-[var(--color-text-highlight)]">
              {t("extensions.dependencyTitle")}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              {targetName}
            </p>
          </div>
        </div>
        <div className="mt-4 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
          {dependencies.length === 0 ? (
            <p className="py-3 text-[11px] text-[var(--color-text-muted)]">
              {t("extensions.informationUnavailable")}
            </p>
          ) : (
            dependencies.map((dependency) => (
              <div
                key={`${dependency.name}-${dependency.version ?? "unknown"}`}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-[var(--color-text-highlight)]">
                    {dependency.name}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    {dependency.description}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[10px] text-[var(--color-text-muted)]">
                  <p>{dependency.version ?? t("extensions.informationUnavailable")}</p>
                  <p>{dependency.size ?? t("extensions.informationUnavailable")}</p>
                </div>
              </div>
            ))
          )}
        </div>
        {permissions.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11.5px] font-semibold text-[var(--color-text-highlight)]">
              {t("extensions.permission.installPermissionTitle")}
            </p>
            <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
              {permissions.map((permission) => (
                <div key={permission.name} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-[var(--color-text-primary)]">
                      {permission.name}
                    </p>
                    {permission.description && (
                      <p className="mt-0.5 truncate text-[10.5px] text-[var(--color-text-muted)]">
                        {permission.description}
                      </p>
                    )}
                  </div>
                  {permission.level && LEVEL_KEY[permission.level] && (
                    <span className="shrink-0 rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                      {t(LEVEL_KEY[permission.level] as never)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10.5px] text-[var(--color-text-muted)]">
              {t("extensions.permission.installPermissionHint")}
            </p>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="primary" onClick={onConfirm}>
            <Icons.Download size={13} />
            {t("extensions.confirmInstall")}
          </Button>
        </div>
      </GlassContainer>
    </div>
  );
}
