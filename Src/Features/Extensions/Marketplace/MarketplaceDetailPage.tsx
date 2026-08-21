import { useEffect, useMemo, useState } from "react";
import { useLocale } from "../../../Foundation/I18n";
import { useExtensionStore } from "../../../State/useExtensionStore";
import { Button } from "../../../UI/Components/Button";
import { Card } from "../../../UI/Components/Card";
import { MarkdownRenderer } from "../../../UI/Components/MarkdownRenderer";
import { showToast } from "../../../UI/Feedback/Toast";
import { Icons } from "../../../UI/Icons/IconManager";
import { ExtensionIcon } from "./ExtensionIcon";
import {
  descriptorToMarketplaceItem,
  type MarketplaceExtensionItem,
  MarketplaceService,
} from "./MarketplaceService";

interface MarketplaceDetailPageProps {
  extensionId: string;
}

export function MarketplaceDetailPage({ extensionId }: MarketplaceDetailPageProps) {
  const { t, locale } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);

  const [activeSubTab, setActiveSubTab] = useState<"details" | "features" | "changelog">("details");
  const [onlineItem, setOnlineItem] = useState<MarketplaceExtensionItem | null>(null);

  // 1. 本地已安装的 descriptor
  const localDescriptor = useMemo(() => {
    return descriptors.find((d) => d.id === extensionId);
  }, [descriptors, extensionId]);

  // 2. 尝试从远程 API 检索该扩展的完整元数据与 README
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const result = await MarketplaceService.fetchMarketplace(undefined, undefined, descriptors);
        const match = result.items.find((it) => it.id === extensionId);
        if (isMounted && match) {
          setOnlineItem(match);
        }
      } catch {
        // 保持使用本地描述符
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [extensionId, descriptors]);

  // 3. 聚合扩展数据对象
  const item: MarketplaceExtensionItem = useMemo(() => {
    if (onlineItem) return onlineItem;
    if (localDescriptor) return descriptorToMarketplaceItem(localDescriptor);
    return {
      id: extensionId,
      name: extensionId,
      displayName: { "zh-CN": extensionId, en: extensionId },
      publisher: "Community",
      version: "0.1.0",
      description: t("extensions.loading"),
      displayDescription: { "zh-CN": t("extensions.loading"), en: t("extensions.loading") },
      category: "Developer Tools",
      tags: [],
      downloads: 0,
      rating: 5.0,
      verified: false,
      installed: Boolean(localDescriptor),
      enabled: true,
      packageType:
        extensionId.startsWith("vscode-") || extensionId.endsWith(".vsix") ? "vsix" : "aurx",
    };
  }, [onlineItem, localDescriptor, extensionId, t]);

  const title = item.displayName?.[locale] ?? item.name;
  const description = item.displayDescription?.[locale] ?? item.description;

  const handleInstall = () => {
    showToast(`${t("extensions.installing")} ${title}`, "info");
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--color-surface-1)] text-[var(--color-text-primary)] overflow-y-auto select-none">
      {/* 顶部大 Hero 区域 */}
      <div className="border-b border-[var(--border-subtle)] bg-[var(--color-surface-2)]/40 px-8 py-6 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          {/* 左侧：大图标与核心元数据 */}
          <div className="flex items-start gap-5 min-w-0">
            <div className="size-20 shrink-0 rounded-2xl bg-[var(--color-surface-3)] border border-[var(--border-subtle)] flex items-center justify-center shadow-lg overflow-hidden p-2">
              <ExtensionIcon icon={item.icon} name={title} size={56} />
            </div>

            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-[22px] font-bold tracking-tight text-[var(--color-text-highlight)] truncate">
                  {title}
                </h1>
                {item.verified && (
                  <span className="flex items-center gap-1 text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                    <Icons.Check size={12} stroke={2.5} />
                    {t("extensions.officialVerified")}
                  </span>
                )}
                <span className="text-[11px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-3)] px-2 py-0.5 rounded-md border border-[var(--border-subtle)]">
                  {item.id}
                </span>
              </div>

              <p className="text-[13.5px] text-[var(--color-text-secondary)] leading-relaxed max-w-2xl">
                {description}
              </p>

              {/* 徽标胶囊行 */}
              <div className="flex items-center gap-2 pt-1 flex-wrap text-[11px] text-[var(--color-text-muted)]">
                <span className="flex items-center gap-1 font-medium text-[var(--color-text-primary)]">
                  <span className="text-[var(--color-text-muted)]">
                    {t("extensions.publisher")}:
                  </span>{" "}
                  {item.publisher}
                </span>
                <span>•</span>
                <span>
                  {t("extensions.version")} {item.version}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 text-amber-400 font-semibold">
                  <Icons.Sparkles size={12} />
                  {item.rating.toFixed(1)}
                </span>
                <span>•</span>
                <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface-3)] border border-[var(--border-subtle)]">
                  {item.category}
                </span>
              </div>
            </div>
          </div>

          {/* 右侧：单一安装操作按钮 */}
          <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
            <Button
              variant="primary"
              size="default"
              className="h-9 px-6 text-[13px] rounded-xl font-medium shadow-md flex items-center gap-1.5"
              onClick={handleInstall}
            >
              <Icons.Download size={14} />
              {t("extensions.install")}
            </Button>
          </div>
        </div>
      </div>

      {/* 主体双栏区域 (7:3 布局) */}
      <div className="max-w-6xl w-full mx-auto p-8 flex flex-col md:flex-row gap-8 flex-1">
        {/* 左侧主内容区 (70%) */}
        <div className="flex-1 flex flex-col gap-5 min-w-0">
          {/* SubTab 导航条 */}
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2">
            <button
              type="button"
              onClick={() => setActiveSubTab("details")}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                activeSubTab === "details"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t("extensions.detailsTab")}
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab("features")}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                activeSubTab === "features"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t("extensions.featuresTab")}
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab("changelog")}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                activeSubTab === "changelog"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t("extensions.changelogTab")}
            </button>
          </div>

          {/* Tab 页面内容 */}
          {activeSubTab === "details" && (
            <div className="flex flex-col gap-4 leading-relaxed text-[13.5px]">
              {item.readme ? (
                <Card className="p-6 rounded-2xl">
                  <MarkdownRenderer content={item.readme} />
                </Card>
              ) : (
                <Card className="p-6 rounded-2xl flex flex-col gap-3">
                  <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                    {t("extensions.aboutExtension")}
                  </h3>
                  <MarkdownRenderer content={description || t("extensions.defaultDescription")} />
                  <p className="text-[12.5px] text-[var(--color-text-muted)] border-t border-[var(--border-subtle)] pt-3 mt-1">
                    {t("extensions.defaultSdkSummary")}
                  </p>
                </Card>
              )}
            </div>
          )}

          {activeSubTab === "features" && (
            <Card className="p-6 rounded-2xl flex flex-col gap-4 text-[13.5px]">
              <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                {t("extensions.featuresTab")}
              </h3>
              <ul className="flex flex-col gap-2.5 text-[var(--color-text-secondary)] list-disc pl-5">
                <li>原生响应主题与色彩自适应切换，界面浑然一体</li>
                <li>无额外冗余依赖，轻量极速加载</li>
                <li>支持快捷命令与沉浸式操作集成</li>
              </ul>
            </Card>
          )}

          {activeSubTab === "changelog" && (
            <Card className="p-6 rounded-2xl flex flex-col gap-3 text-[13.5px]">
              <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                {t("extensions.changelogTab")}
              </h3>
              <div className="flex items-center gap-2 pt-1">
                <span className="font-semibold text-blue-400">v{item.version}</span>
                <span className="text-[12px] text-[var(--color-text-muted)]">(最新发布)</span>
              </div>
              <p className="text-[var(--color-text-secondary)]">
                初始化正式版构建发布，全面接入 Aurona Code SDK v1 标准。
              </p>
            </Card>
          )}
        </div>

        {/* 右侧侧边栏元数据区 (30%) */}
        <div className="w-full md:w-80 shrink-0 flex flex-col gap-5">
          {/* 1. 扩展元数据卡片 */}
          <Card className="p-4 rounded-2xl flex flex-col gap-3">
            <h4 className="text-[12.5px] font-bold tracking-wider uppercase text-[var(--color-text-muted)]">
              {t("extensions.extensionDetails")}
            </h4>
            <div className="flex flex-col gap-2.5 text-[12.5px]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">{t("extensions.publisher")}</span>
                <span className="font-medium text-[var(--color-text-highlight)]">
                  {item.publisher}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">{t("extensions.identifier")}</span>
                <span className="font-mono text-[11px] text-[var(--color-text-primary)]">
                  {item.id}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">{t("extensions.version")}</span>
                <span className="font-medium text-[var(--color-text-highlight)]">
                  {item.version}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">{t("extensions.category")}</span>
                <span className="font-medium text-[var(--color-text-primary)]">
                  {item.category}
                </span>
              </div>
            </div>
          </Card>

          {/* 2. 资源链接 */}
          <Card className="p-4 rounded-2xl flex flex-col gap-2.5 text-[12.5px]">
            <h4 className="text-[12.5px] font-bold tracking-wider uppercase text-[var(--color-text-muted)] mb-1">
              {t("extensions.relatedResources")}
            </h4>
            <a
              href="https://github.com/AuronaLabs/AuronaCode-Early"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline flex items-center gap-1.5"
            >
              <Icons.GitBranch size={13} />
              {t("extensions.sourceAndDocs")}
            </a>
            <a
              href="https://marketplace.aurona.cc"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline flex items-center gap-1.5"
            >
              <Icons.Sparkles size={13} />
              {t("extensions.marketplacePortal")}
            </a>
          </Card>
        </div>
      </div>
    </div>
  );
}
