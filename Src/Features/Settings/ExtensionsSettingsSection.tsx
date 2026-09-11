import { useEffect, useState } from "react";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import type {
  ExtensionDescriptor,
  ExtensionPermissionState,
} from "../../Foundation/IPC/ExtensionCommands";
import { StorageIPC } from "../../Foundation/IPC/StorageCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { useExtensionStore } from "../../State/useExtensionStore";
import { Button } from "../../UI/Components/Button";
import { Card } from "../../UI/Components/Card";
import { Input } from "../../UI/Components/Input";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { resolveExtensionName } from "../Extensions/ExtensionUtils";
import {
  DEFAULT_MARKETPLACE_URL,
  MarketplaceService,
} from "../Extensions/Marketplace/MarketplaceService";

interface PermissionItemDef {
  key: string;
  nameKey: I18nKey;
  descKey: I18nKey;
}

const PERMISSION_DEFS: PermissionItemDef[] = [
  {
    key: "editor.current.read",
    nameKey: "settings.extensionsSettings.permEditorRead",
    descKey: "settings.extensionsSettings.permEditorReadDesc",
  },
  {
    key: "workspace.read",
    nameKey: "settings.extensionsSettings.permWorkspaceRead",
    descKey: "settings.extensionsSettings.permWorkspaceReadDesc",
  },
  {
    key: "workspace.write",
    nameKey: "settings.extensionsSettings.permWorkspaceWrite",
    descKey: "settings.extensionsSettings.permWorkspaceWriteDesc",
  },
  {
    key: "fliuno.search",
    nameKey: "settings.extensionsSettings.permFliunoSearch",
    descKey: "settings.extensionsSettings.permFliunoSearchDesc",
  },
  {
    key: "clipboard.access",
    nameKey: "settings.extensionsSettings.permClipboard",
    descKey: "settings.extensionsSettings.permClipboardDesc",
  },
];

function ExtensionPermissionCard({ descriptor }: { descriptor: ExtensionDescriptor }) {
  const { locale, t } = useLocale();
  const title = resolveExtensionName(descriptor, locale) || descriptor.name;
  const permissionFor = useExtensionStore((state) => state.permissionFor);
  const setPermission = useExtensionStore((state) => state.setPermission);

  const [permStates, setPermStates] = useState<Record<string, ExtensionPermissionState>>({});
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const states: Record<string, ExtensionPermissionState> = {};
      for (const def of PERMISSION_DEFS) {
        try {
          states[def.key] = await permissionFor(descriptor.id, def.key);
        } catch {
          states[def.key] = "unknown";
        }
      }
      if (!cancelled) setPermStates(states);
    })();
    return () => {
      cancelled = true;
    };
  }, [descriptor.id, permissionFor]);

  const handleToggle = async (permKey: string, granted: boolean) => {
    try {
      const nextState = await setPermission(descriptor.id, permKey, granted);
      setPermStates((prev) => ({ ...prev, [permKey]: nextState }));
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

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-xl bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
            <Icons.Extensions size={16} />
          </span>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-[var(--color-text-highlight)]">
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

      <div className="flex flex-col pt-1">
        {PERMISSION_DEFS.map((def) => {
          const isGranted = permStates[def.key] === "granted";
          return (
            <div
              key={def.key}
              className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-1 py-2.5 last:border-b-0"
            >
              <div className="flex flex-col gap-0.5 pr-4">
                <span className="text-[12.5px] font-medium text-[var(--color-text-primary)]">
                  {t(def.nameKey)}
                </span>
                <span className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {t(def.descKey)}
                </span>
              </div>
              <Switch
                checked={isGranted}
                onCheckedChange={(checked) => handleToggle(def.key, checked)}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function ExtensionsSettingsSection() {
  const { t } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);

  const [marketplaceUrl, setMarketplaceUrl] = useState(DEFAULT_MARKETPLACE_URL);
  const [isTestingUrl, setIsTestingUrl] = useState(false);
  const [vscodeCompatEnabled, setVscodeCompatEnabled] = useState(true);

  useEffect(() => {
    void (async () => {
      const url = await MarketplaceService.getServerUrl();
      setMarketplaceUrl(url);
      const config = await UserConfigStore.get();
      setVscodeCompatEnabled(config.vscodeCompatEnabled !== false);
    })();
  }, []);

  const handleSaveMarketplaceUrl = async (url: string) => {
    setMarketplaceUrl(url);
    await MarketplaceService.setServerUrl(url);
    showToast(t("settings.extensionsSettings.marketplaceUrlSaved"), "success");
  };

  const handleResetToDefault = async () => {
    setMarketplaceUrl(DEFAULT_MARKETPLACE_URL);
    await MarketplaceService.setServerUrl(DEFAULT_MARKETPLACE_URL);
    showToast(t("settings.extensionsSettings.marketplaceUrlReset"), "success");
  };

  const handleTestConnection = async () => {
    setIsTestingUrl(true);
    try {
      const cleanBase = marketplaceUrl.trim().replace(/\/+$/, "");
      const candidateUrls: string[] = [];

      if (cleanBase.endsWith("/api") || cleanBase.includes("/api/")) {
        candidateUrls.push(`${cleanBase}/extensions`);
        candidateUrls.push(`${cleanBase.replace(/\/api\/?$/, "")}/extensions`);
      } else {
        candidateUrls.push(`${cleanBase}/api/extensions`);
        candidateUrls.push(`${cleanBase}/extensions`);
      }

      let connected = false;
      let statusText = "";

      for (const urlStr of candidateUrls) {
        try {
          const res = await fetch(urlStr, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) {
            connected = true;
            statusText = `HTTP ${res.status}`;
            break;
          }
        } catch {
          // 尝试下一候选
        }
      }

      if (connected) {
        showToast(
          t("settings.extensionsSettings.marketplaceReachable").replace("{status}", statusText),
          "success",
        );
      } else {
        showToast(t("settings.extensionsSettings.marketplaceUnreachable"), "warning");
      }
    } catch {
      showToast(t("settings.extensionsSettings.marketplaceConnectFailed"), "warning");
    } finally {
      setIsTestingUrl(false);
    }
  };

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
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.extensions")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {t("settings.extensionsSettings.description")}
        </p>
      </div>

      {/* 1. Marketplace 服务器源配置 */}
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-bold text-[var(--color-text-highlight)]">
              {t("settings.extensionsSettings.marketplaceUrlTitle")}
            </span>
            <span className="text-[11.5px] text-[var(--color-text-muted)]">
              {t("settings.extensionsSettings.marketplaceUrlDescription")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleResetToDefault}
              className="h-7 px-2.5 text-[11.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)]"
            >
              <Icons.Refresh size={12} className="mr-1 inline" />
              {t("settings.extensionsSettings.resetToOfficial")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isTestingUrl}
              onClick={handleTestConnection}
              className="h-7 px-3 text-[11.5px]"
            >
              <Icons.Sparkles
                size={12}
                className={`mr-1 inline ${isTestingUrl ? "animate-spin text-[var(--color-accent)]" : ""}`}
              />
              {t("settings.extensionsSettings.testConnection")}
            </Button>
          </div>
        </div>

        {/* 官方标准输入框 */}
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={marketplaceUrl}
            onChange={(e) => setMarketplaceUrl(e.target.value)}
            onBlur={() => handleSaveMarketplaceUrl(marketplaceUrl)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveMarketplaceUrl(marketplaceUrl);
            }}
            placeholder="https://marketplace.aurona.cc/ 或 http://127.0.0.1:5219/api"
            fullWidth
            inputSize="default"
            className="flex-1 font-mono"
          />
          <Button
            size="sm"
            className="h-7 px-3 text-[11.5px]"
            onClick={() => handleSaveMarketplaceUrl(marketplaceUrl)}
          >
            {t("common.save")}
          </Button>
        </div>
      </Card>

      {/* 2. VSCode 兼容内核：内置运行时，不作为侧边栏扩展 */}
      <Card className="flex items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]">
            <Icons.FileCode size={17} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-[var(--color-text-highlight)]">
                {t("settings.extensionsSettings.vscodeCompatTitle")}
              </span>
              <span className="rounded border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                {t("settings.extensionsSettings.builtinBadge")}
              </span>
            </div>
            <span className="text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
              {t("settings.extensionsSettings.vscodeCompatDescription")}
            </span>
          </div>
        </div>
        <Switch checked={vscodeCompatEnabled} onCheckedChange={handleVscodeCompatToggle} />
      </Card>

      {/* 3. 已安装扩展的独立权限矩阵 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[14px] font-bold text-[var(--color-text-highlight)]">
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
