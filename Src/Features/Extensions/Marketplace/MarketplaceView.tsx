import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../../Foundation/I18n";
import { useExtensionStore } from "../../../State/useExtensionStore";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";
import { Button } from "../../../UI/Components/Button";
import { Input } from "../../../UI/Components/Input";
import { Select } from "../../../UI/Components/Select";
import { showToast } from "../../../UI/Feedback/Toast";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../../UI/Layouts/SidebarPage";
import { MarketplaceCard } from "./MarketplaceCard";
import {
  descriptorToMarketplaceItem,
  type MarketplaceExtensionItem,
  MarketplaceService,
  type MarketplaceSourceStatus,
} from "./MarketplaceService";

export function MarketplaceView() {
  const { t, locale } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);
  const openTab = useWorkbenchStore((state) => state.openTab);

  const [activeTab, setActiveTab] = useState<"discover" | "installed">("discover");
  const [selectedFilter, setSelectedFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<MarketplaceExtensionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<MarketplaceSourceStatus>("online");
  const [offlineReason, setOfflineReason] = useState<
    "server-unreachable" | "invalid-response" | undefined
  >();
  const [installingId, setInstallingId] = useState<string | null>(null);

  const categoryOptions = useMemo(
    () => [
      { value: "All", label: t("extensions.allCategories") },
      { value: "trending", label: t("extensions.categoryTrending") },
      { value: "Productivity", label: t("extensions.categoryProductivity") },
      { value: "Developer Tools", label: t("extensions.categoryDevTools") },
      { value: "Formatters", label: t("extensions.categoryFormatters") },
      { value: "Themes", label: t("extensions.categoryThemes") },
    ],
    [t],
  );

  const refreshCatalog = useCallback(async () => {
    setIsLoading(true);
    try {
      const categoryParam =
        selectedFilter === "trending" || selectedFilter === "All" ? undefined : selectedFilter;
      const result = await MarketplaceService.fetchMarketplace(
        searchQuery,
        categoryParam,
        descriptors,
      );
      setExtensions(result.items);
      setSourceStatus(result.source);
      setOfflineReason(result.offlineReason);
    } catch {
      setSourceStatus("offline");
      setOfflineReason("server-unreachable");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, selectedFilter, descriptors]);

  // 自动实时刷新（支持输入 debounced 响应与分类即时响应）
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshCatalog();
    }, 200);
    return () => clearTimeout(timer);
  }, [refreshCatalog]);

  const displayedExtensions = useMemo(() => {
    let list: MarketplaceExtensionItem[] = [];
    if (activeTab === "installed") {
      list = descriptors.map(descriptorToMarketplaceItem);
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        list = list.filter(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            it.description.toLowerCase().includes(q) ||
            Object.values(it.displayName).some((name) => name.toLowerCase().includes(q)),
        );
      }
      if (selectedFilter !== "All" && selectedFilter !== "trending") {
        list = list.filter((it) => it.category.toLowerCase() === selectedFilter.toLowerCase());
      }
    } else {
      list = extensions;
      if (selectedFilter === "trending") {
        list = [...list].sort((a, b) => b.downloads - a.downloads);
      }
    }
    return list;
  }, [extensions, activeTab, selectedFilter, descriptors, searchQuery]);

  const handleOpenDetailTab = (item: MarketplaceExtensionItem) => {
    const title = item.displayName?.[locale] ?? item.name;
    openTab({
      id: `extension:${item.id}`,
      type: "extension",
      title,
      path: item.id,
    });
  };

  const handleInstall = async (item: MarketplaceExtensionItem) => {
    if (installingId) return;
    setInstallingId(item.id);
    try {
      await MarketplaceService.installExtension(item.id, item.version);
      await useExtensionStore.getState().refresh();
      await refreshCatalog();
    } catch (error) {
      const message = error instanceof Error ? error.message : "下载安装包失败";
      // Keep the action in the Marketplace list; users should not be forced into detail just to retry.
      showToast(message, "warning");
    } finally {
      setInstallingId(null);
    }
  };

  const handleUninstall = async (item: MarketplaceExtensionItem) => {
    if (installingId) return;
    setInstallingId(item.id);
    try {
      await MarketplaceService.uninstallExtension(item.id);
      await useExtensionStore.getState().refresh();
      await refreshCatalog();
      showToast(`${item.displayName?.[locale] ?? item.name} 已卸载`, "info");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "卸载扩展失败", "warning");
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full w-full select-none bg-transparent text-[var(--color-text-primary)]">
      {/* 顶部标题栏：清爽极简与状态展示 */}
      <SidebarPageHeader
        title="Aurona Marketplace"
        actions={
          <Tooltip content={t("extensions.refreshList")} delay={300}>
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              disabled={isLoading}
              className="flex items-center justify-center p-1.5 hover:bg-[var(--material-interactive-hover)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] transition-all cursor-pointer disabled:opacity-50"
              aria-label={t("extensions.refreshList")}
            >
              <Icons.Refresh
                size={16}
                stroke={1.8}
                className={isLoading ? "animate-spin text-[var(--color-text-highlight)]" : ""}
              />
            </button>
          </Tooltip>
        }
      />

      {/* 搜索与分类控制区：通透沉浸式无底色 */}
      <div className="px-[var(--PanelPaddingX)] pt-1 pb-3 flex flex-col gap-2.5 bg-transparent">
        {/* 类似 Commit 风格的微拟物输入框 */}
        <div className="relative flex items-center w-full">
          <Input
            icon={<Icons.Search size={13} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("extensions.searchPlaceholder")}
            fullWidth
            inputSize="default"
            surface="glass"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
            >
              <Icons.Close size={12} />
            </button>
          )}
        </div>

        {/* 控制栏：左侧与 Git 对齐的菜单项 + 右侧微型分类下拉 */}
        <div className="flex items-center justify-between gap-2">
          {/* 左侧：与 Git 源码管理完全对齐的子菜单按钮 */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className={`relative flex h-[28px] items-center justify-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-colors duration-150 cursor-pointer ${
                activeTab === "discover"
                  ? "border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
              }`}
              onClick={() => setActiveTab("discover")}
            >
              <Icons.Compass size={13} /> {t("extensions.discover")}
            </button>
            <button
              type="button"
              className={`relative flex h-[28px] items-center justify-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-colors duration-150 cursor-pointer ${
                activeTab === "installed"
                  ? "border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
              }`}
              onClick={() => setActiveTab("installed")}
            >
              <Icons.Package size={13} /> {t("extensions.installed")}
            </button>
          </div>

          {/* 右侧：单行微型分类选择器 */}
          <div className="w-28 shrink-0">
            <Select
              value={selectedFilter}
              onChange={(val) => setSelectedFilter(val)}
              options={categoryOptions}
              className="h-7 min-w-[110px] text-[11px] px-2 py-0.5 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* 插件列表区域 */}
      {sourceStatus === "offline" && activeTab === "discover" && (
        <div className="mx-[var(--PanelPaddingX)] mb-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-300">
          Marketplace 当前离线，正在显示最近一次成功同步的缓存。
          {offlineReason === "invalid-response"
            ? "服务地址返回了无效响应。"
            : "请确认 Marketplace 服务已启动或网络可用。"}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto aurona-scroll px-[var(--PanelPaddingX)] pb-4 flex flex-col gap-2.5">
        {isLoading && extensions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center text-[var(--color-text-muted)]">
            <Icons.Refresh size={22} className="animate-spin text-blue-400 opacity-70" />
            <span className="text-[12px] font-medium">{t("extensions.loading")}</span>
          </div>
        ) : displayedExtensions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center text-[var(--color-text-muted)]">
            <Icons.Extensions size={28} className="opacity-40" />
            <span className="text-[12.5px] font-medium">{t("extensions.emptyList")}</span>
            <span className="text-[11px]">{t("extensions.emptyListHint")}</span>
            {sourceStatus === "offline" && activeTab === "discover" && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 h-7 text-[11px] px-3"
                onClick={() => void refreshCatalog()}
              >
                <Icons.Refresh size={11} className="mr-1 inline" />
                {t("extensions.refreshList")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {displayedExtensions.map((item) => (
              <MarketplaceCard
                key={item.id}
                item={item}
                onOpenDetail={(it) => handleOpenDetailTab(it)}
                onInstall={(it) => void handleInstall(it)}
                onUninstall={(it) => void handleUninstall(it)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
