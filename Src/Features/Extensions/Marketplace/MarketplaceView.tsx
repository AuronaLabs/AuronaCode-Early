import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../../Foundation/I18n";
import { useExtensionStore } from "../../../State/useExtensionStore";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";
import { Input } from "../../../UI/Components/Input";
import { Select } from "../../../UI/Components/Select";
import { Icons } from "../../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../../UI/Layouts/SidebarPage";
import { MarketplaceCard } from "./MarketplaceCard";
import {
  descriptorToMarketplaceItem,
  type MarketplaceExtensionItem,
  MarketplaceService,
} from "./MarketplaceService";

export function MarketplaceView() {
  const { t, locale } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);
  const openTab = useWorkbenchStore((state) => state.openTab);

  const [activeTab, setActiveTab] = useState<"discover" | "installed">("discover");
  const [selectedFilter, setSelectedFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<MarketplaceExtensionItem[]>([]);

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
    try {
      const categoryParam =
        selectedFilter === "trending" || selectedFilter === "All" ? undefined : selectedFilter;
      const result = await MarketplaceService.fetchMarketplace(
        searchQuery,
        categoryParam,
        descriptors,
      );
      setExtensions(result.items);
    } catch {
      // 优雅静默降级
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

  const installedCount = descriptors.length;

  const handleOpenDetailTab = (item: MarketplaceExtensionItem) => {
    const title = item.displayName?.[locale] ?? item.name;
    openTab({
      id: `extension:${item.id}`,
      type: "extension",
      title,
      path: item.id,
    });
  };

  return (
    <div className="flex flex-col h-full w-full select-none bg-transparent text-[var(--color-text-primary)]">
      {/* 顶部标题栏：清爽极简 */}
      <SidebarPageHeader title="Aurona Marketplace" />

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

        {/* 极简流线型控制栏：左侧分段胶囊 + 右侧微型分类下拉 */}
        <div className="flex items-center justify-between gap-2">
          {/* 左侧：微拟物分段胶囊 */}
          <div className="inline-flex p-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--material-surface)]">
            <button
              type="button"
              onClick={() => setActiveTab("discover")}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
                activeTab === "discover"
                  ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t("extensions.discover")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("installed")}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
                activeTab === "installed"
                  ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t("extensions.installed")} ({installedCount})
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
      <div className="flex-1 min-h-0 overflow-y-auto aurona-scroll px-[var(--PanelPaddingX)] pb-4 flex flex-col gap-2.5">
        {displayedExtensions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center text-[var(--color-text-muted)]">
            <Icons.Extensions size={28} className="opacity-40" />
            <span className="text-[12.5px] font-medium">{t("extensions.emptyList")}</span>
            <span className="text-[11px]">{t("extensions.emptyListHint")}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {displayedExtensions.map((item) => (
              <MarketplaceCard
                key={item.id}
                item={item}
                onOpenDetail={(it) => handleOpenDetailTab(it)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
