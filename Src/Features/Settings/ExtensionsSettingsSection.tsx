import { useEffect, useMemo, useState } from "react";
import { resolveExtensionName } from "../../Core/Extensions/ExtensionRegistry";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import type {
  ExtensionDescriptor,
  ExtensionPermissionCatalogEntry,
  ExtensionPermissionState,
} from "../../Foundation/IPC/ExtensionCommands";
import { ExtensionIPC } from "../../Foundation/IPC/ExtensionCommands";
import { NetworkIPC } from "../../Foundation/IPC/NetworkCommands";
import { StorageIPC } from "../../Foundation/IPC/StorageCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { useExtensionStore } from "../../State/useExtensionStore";
import { Badge } from "../../UI/Components/Badge";
import { Button } from "../../UI/Components/Button";
import { Card } from "../../UI/Components/Card";
import { Modal } from "../../UI/Components/Modal";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";

/** 等级徽标配色：常规 / 敏感 / 危险 */
const LEVEL_BADGE: Record<string, string> = {
  normal: "text-[var(--color-text-muted)] border-[var(--border-subtle)]",
  sensitive: "text-[var(--StatusWarning)] border-[var(--StatusWarning)]/40",
  critical: "text-[var(--StatusError)] border-[var(--StatusError)]/40",
};

const LEVEL_KEY: Record<string, I18nKey> = {
  normal: "extensions.permission.levelNormal",
  sensitive: "extensions.permission.levelSensitive",
  critical: "extensions.permission.levelCritical",
};

const SCOPE_KEY: Record<string, I18nKey> = {
  once: "extensions.permission.scopeOnce",
  workspace: "extensions.permission.scopeWorkspace",
  global: "extensions.permission.scopeGlobal",
};

const SCOPE_HINT_KEY: Record<string, I18nKey> = {
  once: "extensions.permission.scopeHintOnce",
  workspace: "extensions.permission.scopeHintWorkspace",
  global: "extensions.permission.scopeHintGlobal",
};

function ExtensionPermissionCard({ descriptor }: { descriptor: ExtensionDescriptor }) {
  const { locale, t } = useLocale();
  const title = resolveExtensionName(descriptor, locale) || descriptor.name;
  const permissionFor = useExtensionStore((state) => state.permissionFor);
  const setPermission = useExtensionStore((state) => state.setPermission);
  const permissionScopes = useExtensionStore((state) => state.permissionScopes);
  const permissionCatalog = useExtensionStore((state) => state.permissionCatalog);

  const [permStates, setPermStates] = useState<Record<string, ExtensionPermissionState>>({});
  const [isResetting, setIsResetting] = useState(false);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  // 目录按 id 索引；扩展声明的权限与目录求交（memo 稳定引用，供 effect 依赖）
  const declaredRows = useMemo(() => {
    const catalogById = new Map<string, ExtensionPermissionCatalogEntry>(
      permissionCatalog.map((entry) => [entry.id, entry]),
    );
    return descriptor.permissions
      .map((id) => catalogById.get(id))
      .filter((entry): entry is ExtensionPermissionCatalogEntry => Boolean(entry));
  }, [descriptor.permissions, permissionCatalog]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const states: Record<string, ExtensionPermissionState> = {};
      for (const row of declaredRows) {
        try {
          states[row.id] = await permissionFor(descriptor.id, row.id);
        } catch {
          states[row.id] = "unknown";
        }
      }
      if (!cancelled) setPermStates(states);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor.id, permissionFor, declaredRows]);

  const handleGrant = async (permId: string) => {
    try {
      // 设置矩阵里的授权一律落在"此工作区"作用域；跨工作区请到侧边栏授权弹窗选择
      const nextState = await setPermission(descriptor.id, permId, true, "workspace");
      setPermStates((prev) => ({ ...prev, [permId]: nextState }));
      showToast(
        t("settings.extensionsSettings.permissionUpdatedToast").replace("{name}", title),
        "info",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleRevoke = async (permId: string) => {
    try {
      // 撤销 = 恢复 unknown（下次使用重新询问），与"拒绝"不同
      await ExtensionIPC.revokePermission(descriptor.id, permId);
      setPermStates((prev) => ({ ...prev, [permId]: "unknown" }));
      showToast(
        t("settings.extensionsSettings.permissionUpdatedToast").replace("{name}", title),
        "info",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleRevokeAll = async () => {
    setConfirmRevokeAll(false);
    try {
      await useExtensionStore.getState().revokeAllPermissions(descriptor.id);
      const states: Record<string, ExtensionPermissionState> = {};
      for (const row of declaredRows) states[row.id] = "unknown";
      setPermStates(states);
      showToast(
        t("settings.extensionsSettings.permissionUpdatedToast").replace("{name}", title),
        "info",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleResetStorage = async () => {
    setIsResetting(true);
    try {
      const clearedBytes = await StorageIPC.clearExtensionStorageFor(descriptor.id);
      if (clearedBytes > 0) {
        showToast(
          t("settings.extensionsSettings.storageResetToast").replace("{name}", title),
          "success",
        );
      } else {
        showToast(
          t("settings.extensionsSettings.storageResetEmptyToast").replace("{name}", title),
          "info",
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIsResetting(false);
    }
  };

  const hasAnyGrant = declaredRows.some((row) => permStates[row.id] === "granted");

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-control bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
            <Icons.Extensions size={16} />
          </span>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
                {title}
              </span>
              <span className="rounded border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                {descriptor.id}
              </span>
            </div>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {descriptor.publisher} · v{descriptor.version}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={!hasAnyGrant}
            onClick={() => setConfirmRevokeAll(true)}
            className="h-7 px-2.5 text-[11px] text-[var(--StatusWarning)] disabled:opacity-40"
          >
            <Icons.ShieldOff size={12} className="mr-1 inline" />
            {t("extensions.permission.revokeAll")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isResetting}
            onClick={handleResetStorage}
            className="h-7 px-2.5 text-[11px] text-[var(--StatusError)]"
          >
            <Icons.Trash size={12} className="mr-1 inline" />
            {t("settings.extensionsSettings.resetStorage")}
          </Button>
        </div>
      </div>

      {declaredRows.length === 0 ? (
        <div className="pt-1 text-[11.5px] text-[var(--color-text-muted)]">
          {t("extensions.permission.notDeclared")}
        </div>
      ) : (
        <div className="flex flex-col pt-1">
          {declaredRows.map((row) => {
            const state = permStates[row.id] ?? "unknown";
            const scope = permissionScopes[`${descriptor.id}:${row.id}`] ?? "unknown";
            const isGranted = state === "granted";
            return (
              <div
                key={row.id}
                className="settings-row flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-1 py-2.5 last:border-b-0"
              >
                <div className="flex min-w-0 flex-col gap-1 pr-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-medium text-[var(--color-text-primary)]">
                      {t(row.titleKey as I18nKey)}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] ${LEVEL_BADGE[row.level]}`}
                    >
                      {t(LEVEL_KEY[row.level])}
                    </span>
                    {isGranted && SCOPE_KEY[scope] && (
                      <span className="rounded border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                        {t(SCOPE_KEY[scope])}
                      </span>
                    )}
                    {!row.available && (
                      <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                        {t("extensions.permission.notAvailable")}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    {isGranted && SCOPE_HINT_KEY[scope]
                      ? t(SCOPE_HINT_KEY[scope])
                      : t(row.descriptionKey as I18nKey)}
                  </span>
                </div>
                {row.available ? (
                  isGranted ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRevoke(row.id)}
                      className="h-7 px-2.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--StatusWarning)]"
                    >
                      {t("extensions.revoke")}
                    </Button>
                  ) : (
                    <Switch checked={false} onCheckedChange={() => void handleGrant(row.id)} />
                  )
                ) : (
                  <span className="text-[11px] text-[var(--color-text-muted)]">—</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={confirmRevokeAll}
        onClose={() => setConfirmRevokeAll(false)}
        title={t("extensions.permission.revokeAllConfirmTitle")}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmRevokeAll(false)}
              className="text-[12px]"
            >
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="danger" onClick={handleRevokeAll} className="text-[12px]">
              {t("extensions.permission.revokeAll")}
            </Button>
          </div>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-[var(--color-text-secondary)]">
          {t("extensions.permission.revokeAllConfirmDescription").replace("{name}", title)}
        </p>
      </Modal>
    </Card>
  );
}

export function ExtensionsSettingsSection() {
  const { t, locale } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);
  const refreshExtensions = useExtensionStore((state) => state.refresh);

  const [vscodeCompatEnabled, setVscodeCompatEnabled] = useState(true);
  const [isInstallingVsix, setIsInstallingVsix] = useState(false);

  // VSIX 测试插件（vscode-* 系）：经安装入口装载，可卸载
  const vscodeTestExtensions = useMemo(
    () => descriptors.filter((desc) => desc.id.startsWith("vscode-") || desc.id.endsWith(".vsix")),
    [descriptors],
  );

  const handleInstallDefaultVsix = async () => {
    setIsInstallingVsix(true);
    try {
      const descriptor = await ExtensionIPC.installDefaultVscode();
      await refreshExtensions();
      showToast(
        t("settings.extensionsSettings.vscodeTestInstalled").replace(
          "{name}",
          resolveExtensionName(descriptor, locale) || descriptor.name,
        ),
        "success",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "warning");
    } finally {
      setIsInstallingVsix(false);
    }
  };

  const handleInstallLocalVsix = async () => {
    setIsInstallingVsix(true);
    try {
      const artifact = await NetworkIPC.pickArtifact("vscode");
      if (!artifact) return;
      const descriptor = await ExtensionIPC.installVscode(artifact.artifactId);
      await refreshExtensions();
      showToast(
        t("settings.extensionsSettings.vscodeTestInstalled").replace(
          "{name}",
          resolveExtensionName(descriptor, locale) || descriptor.name,
        ),
        "success",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "warning");
    } finally {
      setIsInstallingVsix(false);
    }
  };

  const handleUninstallTestExtension = async (extensionId: string) => {
    try {
      await ExtensionIPC.uninstall(extensionId);
      await refreshExtensions();
      showToast(t("settings.extensionsSettings.vscodeTestUninstalled"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "warning");
    }
  };

  useEffect(() => {
    void (async () => {
      const config = await UserConfigStore.get();
      setVscodeCompatEnabled(config.vscodeCompatEnabled !== false);
    })();
  }, []);

  const handleVscodeCompatToggle = async (enabled: boolean) => {
    setVscodeCompatEnabled(enabled);
    await UserConfigStore.set({ vscodeCompatEnabled: enabled });
    showToast(
      enabled
        ? t("settings.extensionsSettings.vscodeCompatEnabledToast")
        : t("settings.extensionsSettings.vscodeCompatDisabledToast"),
      "info",
    );
  };

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="settings-section-header">
        <h3 className="settings-section-title">{t("settings.categories.extensions")}</h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.extensionsSettings.description")}
        </p>
      </div>

      {/* 2. VSCode 兼容插件：兼容内核开关 + Demo/本地 .vsix 安装融合为一张卡（0.4.6） */}
      <Card className={`flex flex-col gap-3 p-5 ${vscodeCompatEnabled ? "" : "opacity-60"}`}>
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
              <Icons.FileCode size={17} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
                  {t("settings.extensionsSettings.vscodeTestTitle")}
                </span>
                <Badge variant="neutral">{t("settings.extensionsSettings.builtinBadge")}</Badge>
              </div>
              <span className="text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
                {t("settings.extensionsSettings.vscodeTestDescription")}
              </span>
            </div>
          </div>
          <Switch checked={vscodeCompatEnabled} onCheckedChange={handleVscodeCompatToggle} />
        </div>
        <div className={`flex flex-col gap-3 ${vscodeCompatEnabled ? "" : "pointer-events-none"}`}>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={!vscodeCompatEnabled || isInstallingVsix}
              onClick={() => void handleInstallDefaultVsix()}
              className="h-7 px-3 text-[11.5px]"
            >
              {t("settings.extensionsSettings.vscodeTestInstallDefault")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!vscodeCompatEnabled || isInstallingVsix}
              onClick={() => void handleInstallLocalVsix()}
              className="h-7 px-3 text-[11.5px]"
            >
              {t("settings.extensionsSettings.vscodeTestInstallLocal")}
            </Button>
          </div>

          {vscodeTestExtensions.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-3">
              {vscodeTestExtensions.map((desc) => (
                <div
                  key={desc.id}
                  className="flex items-center justify-between gap-3 rounded-surface bg-[var(--color-surface-2)]/60 px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[12.5px] font-medium text-[var(--color-text-primary)]">
                      {resolveExtensionName(desc, locale) || desc.name}
                      <span className="ml-2 font-mono text-[10.5px] text-[var(--color-text-muted)]">
                        v{desc.version}
                      </span>
                    </span>
                    <span className="truncate font-mono text-[10.5px] text-[var(--color-text-muted)]">
                      {desc.id}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--StatusError)]"
                    onClick={() => void handleUninstallTestExtension(desc.id)}
                  >
                    <Icons.Trash size={12} className="mr-1 inline" />
                    {t("settings.extensionsSettings.vscodeTestUninstall")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 3. 已安装扩展的独立权限矩阵 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[14px] font-medium text-[var(--color-text-highlight)]">
            {t("settings.extensionsSettings.installedTitle").replace(
              "{count}",
              String(descriptors.length),
            )}
          </h4>
        </div>

        {descriptors.length === 0 ? (
          <GlassContainer
            layer="raised"
            className="p-8 text-center text-xs text-[var(--color-text-muted)]"
          >
            {t("settings.extensionsSettings.noExtensions")}
          </GlassContainer>
        ) : (
          descriptors.map((desc) => <ExtensionPermissionCard key={desc.id} descriptor={desc} />)
        )}
      </div>
    </div>
  );
}
