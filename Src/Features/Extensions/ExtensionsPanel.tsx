import { useEffect, useState } from "react";
import { WorkspaceService } from "../../Core/WorkspaceService";
import { useLocale } from "../../Foundation/I18n";
import type { ExtensionPermissionState } from "../../Foundation/IPC/ExtensionCommands";
import { extensionSidebarId } from "../../Shared/Constants/Sidebar";
import { useExtensionStore } from "../../State/useExtensionStore";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { resolveExtensionName } from "./ExtensionUtils";

function ExtensionPermissionRow({
  extensionId,
  permission,
  title,
  description,
}: {
  extensionId: string;
  permission: string;
  title: string;
  description: string;
}) {
  const { t } = useLocale();
  const [state, setState] = useState<ExtensionPermissionState>("unknown");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await useExtensionStore.getState().permissionFor(extensionId, permission);
        if (!cancelled) setState(next);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [extensionId, permission]);

  const toggle = async (granted: boolean) => {
    const next = await useExtensionStore.getState().setPermission(extensionId, permission, granted);
    setState(next);
  };

  return (
    <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-[var(--color-text-primary)]">{title}</span>
        <span className="truncate text-[10px] text-[var(--color-text-muted)]">{description}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {state === "granted" ? (
          <Button size="sm" variant="ghost" onClick={() => void toggle(false)}>
            {t("extensions.revoke")}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void toggle(true)}>
            {t("extensions.allow")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ExtensionsPanel() {
  const { t, locale } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);
  const views = useExtensionStore((state) => state.views);
  const setActiveSidebar = useWorkbenchStore((state) => state.setActiveSidebar);
  const hasWorkspace = Boolean(WorkspaceService.getCurrent().primaryRoot);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="px-4 pb-2 pt-3">
        <h2 className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
          {t("extensions.sidebarTitle")}
        </h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {descriptors.length === 0 ? (
          <div className="grid flex-1 place-items-center px-4 text-center text-xs text-[var(--color-text-muted)]">
            {t("extensions.noneFound")}
          </div>
        ) : (
          descriptors.map((descriptor) => {
            const icon = views[descriptor.id]?.icon;
            return (
              <div
                key={descriptor.id}
                className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 p-3"
              >
                <div className="flex items-center gap-3">
                  {icon ? (
                    <span
                      className="flex size-8 shrink-0 items-center justify-center text-[var(--color-text-muted)] [&>svg]:size-full [&>svg]:stroke-current"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: extension icon SVG is verified at package build time
                      dangerouslySetInnerHTML={{ __html: icon }}
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium text-[var(--color-text-highlight)]">
                      {resolveExtensionName(descriptor, locale)}
                    </span>
                    <span className="truncate text-[11px] text-[var(--color-text-muted)]">
                      {t("extensions.builtin")} · {descriptor.publisher} · v{descriptor.version}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setActiveSidebar(extensionSidebarId(descriptor.id))}
                  >
                    {t("extensions.open")}
                  </Button>
                </div>

                <div className="mt-1 flex flex-col gap-1 border-t border-[var(--color-border)] pt-1.5">
                  <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    {t("extensions.permissionTitle")}
                  </span>
                  <ExtensionPermissionRow
                    extensionId={descriptor.id}
                    permission="editor.current.read"
                    title={t("extensions.editorReadTitle")}
                    description={t("extensions.editorReadDescription")}
                  />
                  {hasWorkspace ? (
                    <ExtensionPermissionRow
                      extensionId={descriptor.id}
                      permission="workspace.read"
                      title={t("extensions.workspaceReadTitle")}
                      description={t("extensions.workspaceReadDescription")}
                    />
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
