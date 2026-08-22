import { useEffect, useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import type {
  ExtensionDescriptor,
  ExtensionPermissionState,
} from "../../Foundation/IPC/ExtensionCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { useExtensionStore } from "../../State/useExtensionStore";
import { Button } from "../../UI/Components/Button";
import { Card } from "../../UI/Components/Card";
import { Input } from "../../UI/Components/Input";
import { Switch } from "../../UI/Components/Switch";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { resolveExtensionName } from "../Extensions/ExtensionUtils";
import {
  DEFAULT_MARKETPLACE_URL,
  MarketplaceService,
} from "../Extensions/Marketplace/MarketplaceService";

interface PermissionItemDef {
  key: string;
  name: string;
  desc: string;
}

const PERMISSION_DEFS: PermissionItemDef[] = [
  {
    key: "editor.current.read",
    name: "读取活动编辑器文档",
    desc: "允许扩展读取当前激活文件的文本内容与选区范围（如 Markdown 预览）",
  },
  {
    key: "workspace.read",
    name: "读取工作区文件",
    desc: "允许扩展在当前工作区沙箱范围内检索并读取文件",
  },
  {
    key: "workspace.write",
    name: "修改工作区文件",
    desc: "允许扩展在工作区目录内安全创建或修改文件（如 Planner 任务持久化）",
  },
  {
    key: "fliuno.search",
    name: "Fliuno 搜索注入",
    desc: "允许扩展向 Fliuno 全局搜索面板贡献自定义快捷条目与操作",
  },
  {
    key: "clipboard.access",
    name: "系统剪贴板访问",
    desc: "允许扩展向系统剪贴板安全写入或读取文本",
  },
];

function ExtensionPermissionCard({ descriptor }: { descriptor: ExtensionDescriptor }) {
  const { locale } = useLocale();
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
      showToast(`${title} 权限已更新`, "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleResetStorage = async () => {
    setIsResetting(true);
    try {
      showToast(`已重置 ${title} 的本地独立存储`, "success");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Card className="p-4 rounded-2xl flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
            <Icons.Extensions size={16} />
          </span>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-bold text-[var(--color-text-highlight)]">
                {title}
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-3)] px-1.5 py-0.5 rounded font-mono">
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
          variant="secondary"
          disabled={isResetting}
          onClick={handleResetStorage}
          className="h-7 text-[11px] px-2.5 text-[var(--color-text-muted)] hover:text-red-400"
        >
          <Icons.Trash size={12} className="mr-1 inline" />
          重置存储
        </Button>
      </div>

      <div className="flex flex-col gap-2.5 pt-1">
        {PERMISSION_DEFS.map((def) => {
          const isGranted = permStates[def.key] === "granted";
          return (
            <div
              key={def.key}
              className="flex items-center justify-between py-1 px-1 rounded-lg hover:bg-[var(--color-surface-2)]/40 transition-colors"
            >
              <div className="flex flex-col gap-0.5 pr-4">
                <span className="text-[12px] font-medium text-[var(--color-text-primary)]">
                  {def.name}
                </span>
                <span className="text-[10.5px] text-[var(--color-text-muted)] leading-relaxed">
                  {def.desc}
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
    showToast("Marketplace 服务器配置已保存", "success");
  };

  const handleResetToDefault = async () => {
    setMarketplaceUrl(DEFAULT_MARKETPLACE_URL);
    await MarketplaceService.setServerUrl(DEFAULT_MARKETPLACE_URL);
    showToast("已重置回 Marketplace 官方源", "success");
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
        showToast(`Marketplace 市场通信正常 (${statusText})`, "success");
      } else {
        showToast("未能连接到指定的市场服务器，请检查地址是否正确", "warning");
      }
    } catch {
      showToast("无法连接到市场服务器", "warning");
    } finally {
      setIsTestingUrl(false);
    }
  };

  const handleVscodeCompatToggle = async (enabled: boolean) => {
    setVscodeCompatEnabled(enabled);
    await UserConfigStore.set({ vscodeCompatEnabled: enabled });
    showToast(enabled ? "VSCode 兼容内核已启用" : "VSCode 兼容内核已停用", "info");
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.extensions")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          管理 Aurona Marketplace 扩展源、不同应用的独立权限分配与沙箱数据隔离
        </p>
      </div>

      {/* 1. Marketplace 服务器源配置 */}
      <Card className="p-4 rounded-2xl flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13.5px] font-bold text-[var(--color-text-highlight)]">
              Aurona Marketplace 服务地址
            </span>
            <span className="text-[11.5px] text-[var(--color-text-muted)]">
              配置远程扩展市场通信端点（离线或无法连通时自动切换至内置官方精选库）
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleResetToDefault}
              className="h-7 text-[11.5px] px-2.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)]"
            >
              <Icons.Refresh size={12} className="mr-1 inline" />
              重置为官方源
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isTestingUrl}
              onClick={handleTestConnection}
              className="h-7 text-[11.5px] px-3"
            >
              <Icons.Sparkles
                size={12}
                className={`mr-1 inline ${isTestingUrl ? "animate-spin text-blue-400" : ""}`}
              />
              测试连接
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
            className="h-7 text-[11.5px] px-3"
            onClick={() => handleSaveMarketplaceUrl(marketplaceUrl)}
          >
            保存
          </Button>
        </div>
      </Card>

      {/* 2. VSCode 兼容内核：内置运行时，不作为侧边栏扩展 */}
      <Card className="p-4 rounded-2xl flex items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
            <Icons.FileCode size={17} />
          </span>
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-bold text-[var(--color-text-highlight)]">
                VSCode 兼容内核
              </span>
              <span className="text-[10px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded">
                内置
              </span>
            </div>
            <span className="text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
              为 VSIX 扩展提供 vscode API 兼容运行时。它随 Aurona Code
              内置，不显示在侧边栏，也不能从 Marketplace 卸载。
            </span>
          </div>
        </div>
        <Switch checked={vscodeCompatEnabled} onCheckedChange={handleVscodeCompatToggle} />
      </Card>

      {/* 3. 已安装扩展的独立权限矩阵 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[14px] font-bold text-[var(--color-text-highlight)]">
            已安装扩展与独立权限 ({descriptors.length})
          </h4>
        </div>

        {descriptors.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--color-text-muted)]">
            尚未安装任何扩展
          </div>
        ) : (
          descriptors.map((desc) => <ExtensionPermissionCard key={desc.id} descriptor={desc} />)
        )}
      </div>
    </div>
  );
}
