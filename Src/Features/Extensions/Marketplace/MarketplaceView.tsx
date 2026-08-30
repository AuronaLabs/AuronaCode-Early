import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../../Foundation/I18n";
import {
  LanguageServerIPC,
  type ToolchainsOverview,
} from "../../../Foundation/IPC/LanguageServerCommands";
import { useExtensionStore } from "../../../State/useExtensionStore";
import { useInstallProgressStore } from "../../../State/useInstallProgressStore";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";
import { Button } from "../../../UI/Components/Button";
import { Input } from "../../../UI/Components/Input";
import { Select } from "../../../UI/Components/Select";
import { showToast } from "../../../UI/Feedback/Toast";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../../UI/Layouts/SidebarPage";
import { DependencyConfirmModal, type DependencyInfo } from "./DependencyConfirmModal";
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
  const { setProgress, clearProgress } = useInstallProgressStore();

  // 经典的两个菜单项：探索 Discover / 已安装 Installed
  const [activeTab, setActiveTab] = useState<"discover" | "installed">("discover");
  const [selectedFilter, setSelectedFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<MarketplaceExtensionItem[]>([]);
  const [installedToolchains, setInstalledToolchains] = useState<ToolchainsOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<MarketplaceSourceStatus>("online");
  const [offlineReason, setOfflineReason] = useState<
    "server-unreachable" | "invalid-response" | undefined
  >();
  const [installingId, setInstallingId] = useState<string | null>(null);

  // 依赖安装弹窗状态
  const [pendingInstallItem, setPendingInstallItem] = useState<MarketplaceExtensionItem | null>(
    null,
  );
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const categoryOptions = useMemo(
    () => [
      { value: "All", label: t("extensions.allCategories") },
      { value: "trending", label: t("extensions.categoryTrending") },
      { value: "LSP", label: t("extensions.badgeLsp") },
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
      const [result, toolchains] = await Promise.all([
        MarketplaceService.fetchMarketplace(searchQuery, categoryParam, descriptors),
        LanguageServerIPC.listToolchains().catch(() => null),
      ]);
      // 市场大厅中彻底隐藏 runtime，只保留常规扩展与 LSP 服务
      setExtensions(result.items.filter((it) => it.kind !== "runtime"));
      setSourceStatus(result.source);
      setOfflineReason(result.offlineReason);
      if (toolchains) {
        setInstalledToolchains(toolchains);
      }
    } catch {
      setSourceStatus("offline");
      setOfflineReason("server-unreachable");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, selectedFilter, descriptors]);

  // 自动实时刷新
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshCatalog();
    }, 200);
    return () => clearTimeout(timer);
  }, [refreshCatalog]);

  // 聚合已安装与远端市场数据
  const displayedExtensions = useMemo(() => {
    let list: MarketplaceExtensionItem[] = [];

    if (activeTab === "installed") {
      // 1. 已安装的常规扩展插件
      const installedExts = descriptors.map(descriptorToMarketplaceItem);

      // 2. 已安装的 LSP 工具链转换为市场卡片展示
      const installedLspItems: MarketplaceExtensionItem[] = (
        installedToolchains?.servers || []
      ).map((srv) => ({
        id: srv.id,
        kind: "lsp",
        name: srv.name,
        displayName: { [locale]: srv.name, "zh-CN": srv.name, en: srv.name },
        description: `已安装的智能语言感知服务 (${srv.languages.join(", ")})`,
        displayDescription: {
          [locale]: `已安装的智能语言感知服务 (${srv.languages.join(", ")})`,
        },
        version: srv.version,
        publisher: "auronalabs",
        verified: true,
        installed: true,
        category: "LSP",
        tags: ["lsp", ...srv.languages],
        packageType: "aurlsp",
        downloads: 1000,
        rating: 5,
        reviewCount: 1,
        lspMetadata: {
          languages: srv.languages,
          runtimeType: srv.runtimeType,
          entry: srv.installPath,
        },
      }));

      list = [...installedExts, ...installedLspItems];

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        list = list.filter(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            it.description.toLowerCase().includes(q) ||
            it.lspMetadata?.languages?.some((lang) => lang.toLowerCase().includes(q)) ||
            Object.values(it.displayName).some((name) => name.toLowerCase().includes(q)),
        );
      }

      if (selectedFilter !== "All" && selectedFilter !== "trending") {
        list = list.filter((it) => it.category.toLowerCase() === selectedFilter.toLowerCase());
      }
    } else {
      // 探索大厅：混搭常规插件与 LSP 语言服务
      list = extensions.filter((it) => it.kind !== "runtime");

      // 标记 LSP 本地是否已安装
      if (installedToolchains?.servers) {
        const installedLspIds = new Set(installedToolchains.servers.map((s) => s.id));
        list = list.map((item) => {
          if (item.kind === "lsp" && installedLspIds.has(item.id)) {
            return { ...item, installed: true };
          }
          return item;
        });
      }

      if (selectedFilter === "trending") {
        list = [...list].sort((a, b) => b.downloads - a.downloads);
      } else if (selectedFilter === "LSP") {
        list = list.filter((it) => it.kind === "lsp");
      }
    }
    return list;
  }, [
    extensions,
    activeTab,
    selectedFilter,
    descriptors,
    installedToolchains,
    locale,
    searchQuery,
  ]);

  const handleOpenDetailTab = (item: MarketplaceExtensionItem) => {
    const title = item.displayName?.[locale] ?? item.name;
    openTab({
      id: `extension:${item.id}`,
      type: "extension",
      title,
      path: item.id,
    });
  };

  // 执行真正的安装操作
  const executeInstall = async (item: MarketplaceExtensionItem) => {
    if (installingId) return;
    setInstallingId(item.id);
    setProgress(item.id, "preparing", 5, "正在准备安装...");

    try {
      if (item.kind === "lsp" || item.id.startsWith("auronalabs.lsp-")) {
        // 安装 LSP 语言服务包（流式异步下载与进度反馈）
        await MarketplaceService.installLspServer(item.id, item.version, (percentage, stage) => {
          const msg = stage === "downloading" ? "正在下载语言服务..." : "正在解压部署...";
          setProgress(item.id, "downloading", percentage, msg);
        });
        setProgress(item.id, "completed", 100, "安装完成");
        showToast(`${item.displayName?.[locale] ?? item.name} 语言服务已安装并就绪`, "info");
      } else {
        // 安装常规扩展插件
        setProgress(item.id, "downloading", 40, "正在下载扩展包...");
        await MarketplaceService.installExtension(item.id, item.version);
        setProgress(item.id, "completed", 100, "安装完成");
      }
      await useExtensionStore.getState().refresh();
      await refreshCatalog();
      setTimeout(() => clearProgress(item.id), 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "下载安装失败";
      setProgress(item.id, "failed", 0, message);
      showToast(message, "warning");
      setTimeout(() => clearProgress(item.id), 3000);
    } finally {
      setInstallingId(null);
    }
  };

  // 点击安装按钮时的入口判定（检测是否缺少 Node.js 运行时）
  const handleInstallClick = (item: MarketplaceExtensionItem) => {
    const isLsp = item.kind === "lsp" || item.id.startsWith("auronalabs.lsp-");
    const reqRuntime = item.lspMetadata?.runtimeType || "node";
    const hasNode = installedToolchains?.runtimes?.some((r) => r.runtimeType === "node") ?? false;

    // 如果是 LSP 且依赖 node，但本地尚未就绪 node 运行时，弹出 Steam 风格附带环境安装弹窗
    if (isLsp && reqRuntime === "node" && !hasNode) {
      setPendingInstallItem(item);
      setConfirmModalOpen(true);
      return;
    }

    // 否则直接开始安装
    void executeInstall(item);
  };

  const handleUninstall = async (item: MarketplaceExtensionItem) => {
    if (installingId) return;
    setInstallingId(item.id);
    try {
      if (item.kind === "lsp" || item.id.startsWith("auronalabs.lsp-")) {
        await MarketplaceService.uninstallLspServer(item.id);
      } else {
        await MarketplaceService.uninstallExtension(item.id);
      }
      await useExtensionStore.getState().refresh();
      await refreshCatalog();
      showToast(`${item.displayName?.[locale] ?? item.name} 已卸载`, "info");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "卸载失败", "warning");
    } finally {
      setInstallingId(null);
    }
  };

  const modalDependencies: DependencyInfo[] = useMemo(() => {
    if (!pendingInstallItem) return [];
    return [
      {
        name: "Node.js 官方公共基础运行时",
        version: "20.18.0",
        size: "35.2 MB",
        type: "runtime",
        description: "官方共享执行环境，用于运行 TypeScript、Pyright 等前端语言服务",
      },
    ];
  }, [pendingInstallItem]);

  return (
    <div className="flex flex-col h-full w-full select-none bg-transparent text-[var(--color-text-primary)]">
      {/* 附带依赖安装确认弹窗 */}
      <DependencyConfirmModal
        isOpen={confirmModalOpen}
        targetName={pendingInstallItem?.displayName?.[locale] ?? pendingInstallItem?.name ?? ""}
        targetVersion={pendingInstallItem?.version}
        targetType={pendingInstallItem?.kind === "lsp" ? "lsp" : "extension"}
        dependencies={modalDependencies}
        onConfirm={() => {
          setConfirmModalOpen(false);
          if (pendingInstallItem) {
            void executeInstall(pendingInstallItem);
          }
        }}
        onCancel={() => {
          setConfirmModalOpen(false);
          setPendingInstallItem(null);
        }}
      />

      {/* 顶部标题栏 */}
      <SidebarPageHeader
        title="Aurona Marketplace"
        actions={
          <Tooltip content={t("extensions.refreshList")} delay={300}>
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              disabled={isLoading}
              className="flex size-8 items-center justify-center hover:bg-[var(--material-interactive-hover)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] transition-colors cursor-pointer disabled:opacity-50"
              aria-label={t("extensions.refreshList")}
            >
              <Icons.Refresh
                size={15}
                stroke={1.75}
                className={isLoading ? "animate-spin text-blue-400" : ""}
              />
            </button>
          </Tooltip>
        }
      />

      {/* 搜索与分类控制区 */}
      <div className="px-[var(--PanelPaddingX)] pt-1 pb-3 flex flex-col gap-2.5 bg-transparent">
        {/* 搜索框 */}
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

        {/* 控制栏：探索 (Discover) / 已安装 (Installed) Git 同款独立菜单项 + 分类下拉选择器 */}
        <div className="flex items-center gap-1.5 w-full min-w-0">
          {/* 左侧：两个 Git 同款菜单按钮 (取消图标，纯文字) */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className={`relative flex h-[28px] items-center justify-center rounded-lg border px-3 text-[12px] font-medium transition-colors duration-150 cursor-pointer ${
                activeTab === "discover"
                  ? "border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
              }`}
              onClick={() => setActiveTab("discover")}
            >
              <span>{t("extensions.discover")}</span>
            </button>
            <button
              type="button"
              className={`relative flex h-[28px] items-center justify-center rounded-lg border px-3 text-[12px] font-medium transition-colors duration-150 cursor-pointer ${
                activeTab === "installed"
                  ? "border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
              }`}
              onClick={() => setActiveTab("installed")}
            >
              <span>{t("extensions.installed")}</span>
            </button>
          </div>

          {/* 右侧：自适应防溢出分类选择器 */}
          <div className="flex-1 min-w-0">
            <Select
              value={selectedFilter}
              onChange={(val) => setSelectedFilter(val)}
              options={categoryOptions}
              className="h-[28px] w-full min-w-0 text-[11.5px] px-2.5 py-0.5 rounded-lg border-[var(--border-subtle)] bg-[var(--material-surface)]"
            />
          </div>
        </div>
      </div>

      {/* 离线状态提示 */}
      {sourceStatus === "offline" && activeTab === "discover" && (
        <div className="mx-[var(--PanelPaddingX)] mb-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-300">
          Marketplace 当前离线，正在显示缓存数据。
          {offlineReason === "invalid-response"
            ? "服务地址返回了无效响应。"
            : "请确认 Marketplace 服务已启动或网络可用。"}
        </div>
      )}

      {/* 插件与 LSP 混搭列表区域 */}
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
                onInstall={(it) => handleInstallClick(it)}
                onUninstall={(it) => void handleUninstall(it)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
