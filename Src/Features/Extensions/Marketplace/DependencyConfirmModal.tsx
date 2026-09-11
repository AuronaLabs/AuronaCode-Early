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

interface DependencyConfirmModalProps {
  isOpen: boolean;
  targetName: string;
  targetVersion?: string;
  targetType?: "lsp" | "extension";
  dependencies: DependencyInfo[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function DependencyConfirmModal({
  isOpen,
  targetName,
  dependencies,
  onConfirm,
  onCancel,
}: DependencyConfirmModalProps) {
  const { t } = useLocale();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 backdrop-blur-[var(--surface-blur-base)]">
      <GlassContainer layer="overlay" className="w-full max-w-[360px] p-5">
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
