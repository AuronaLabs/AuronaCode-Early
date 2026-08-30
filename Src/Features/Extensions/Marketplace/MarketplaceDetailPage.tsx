import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../../Foundation/I18n";
import { LanguageServerIPC } from "../../../Foundation/IPC/LanguageServerCommands";
import { useExtensionStore } from "../../../State/useExtensionStore";
import { useInstallProgressStore } from "../../../State/useInstallProgressStore";
import { AccountAvatar } from "../../../UI/Components/AccountAvatar";
import { Button } from "../../../UI/Components/Button";
import { Card } from "../../../UI/Components/Card";
import { MarkdownRenderer } from "../../../UI/Components/MarkdownRenderer";
import { showToast } from "../../../UI/Feedback/Toast";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";
import { DependencyConfirmModal } from "./DependencyConfirmModal";
import { ExtensionIcon } from "./ExtensionIcon";
import {
  descriptorToMarketplaceItem,
  type MarketplaceExtensionItem,
  MarketplaceService,
  type ReviewItem,
  type ReviewsResponse,
} from "./MarketplaceService";

interface MarketplaceDetailPageProps {
  extensionId: string;
}

export function MarketplaceDetailPage({ extensionId }: MarketplaceDetailPageProps) {
  const { t, locale } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);
  const refreshExtensions = useExtensionStore((state) => state.refresh);

  const [activeSubTab, setActiveSubTab] = useState<
    "details" | "features" | "changelog" | "reviews"
  >("details");
  const [onlineItem, setOnlineItem] = useState<MarketplaceExtensionItem | null>(null);
  const [reviewsData, setReviewsData] = useState<ReviewsResponse | null>(null);
  const [isStarred, setIsStarred] = useState(false);
  const [isStarring, setIsStarring] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isCopiedId, setIsCopiedId] = useState(false);

  // 评价表单状态
  const [newReviewRating, setNewReviewRating] = useState(5);
  const [newReviewBody, setNewReviewBody] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // 1. 本地已安装的 descriptor
  const localDescriptor = useMemo(() => {
    return descriptors.find((d) => d.id === extensionId);
  }, [descriptors, extensionId]);

  const localOnlyExtension =
    extensionId === "aurona.markdown" ||
    extensionId === "aurona.planner" ||
    extensionId === "aurona.vscode-compat" ||
    extensionId === "vscode-demo";

  // 2. 加载扩展详细信息、星标状态与评价列表
  const loadData = useCallback(async () => {
    if (localOnlyExtension) return;
    try {
      const [detail, reviews, star] = await Promise.all([
        MarketplaceService.fetchExtensionDetail(extensionId),
        MarketplaceService.fetchReviews(extensionId),
        MarketplaceService.checkStarStatus(extensionId),
      ]);
      startTransition(() => {
        if (detail) setOnlineItem(detail);
        if (reviews) setReviewsData(reviews);
        if (star) setIsStarred(star.isStarred);
      });
    } catch {
      // 优雅降级
    }
  }, [extensionId, localOnlyExtension]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // 3. 聚合扩展数据对象
  const item: MarketplaceExtensionItem = useMemo(() => {
    if (onlineItem) {
      const installed = Boolean(localDescriptor);
      return {
        ...onlineItem,
        installed: onlineItem.installed || installed,
        installedVersion: localDescriptor?.version,
        updateAvailable: Boolean(
          localDescriptor &&
            MarketplaceService.isNewerVersion(onlineItem.version, localDescriptor.version),
        ),
      };
    }
    if (localDescriptor && !localDescriptor.marketplace && !extensionId.startsWith("auronalabs.")) {
      return descriptorToMarketplaceItem(localDescriptor);
    }
    return {
      id: extensionId,
      name: extensionId,
      displayName: { "zh-CN": extensionId, en: extensionId },
      publisher: "Aurona Community",
      version: "0.1.0",
      description: t("extensions.loading"),
      displayDescription: { "zh-CN": t("extensions.loading"), en: t("extensions.loading") },
      category: "Developer Tools",
      tags: [],
      downloads: 0,
      rating: 0,
      verified: false,
      installed: Boolean(localDescriptor),
      enabled: true,
      packageType:
        extensionId.startsWith("vscode-") || extensionId.endsWith(".vsix") ? "vsix" : "aurx",
    };
  }, [onlineItem, localDescriptor, extensionId, t]);

  const title =
    (onlineItem?.displayName?.[locale] ?? onlineItem?.displayName?.["zh-CN"]) ||
    (item.displayName?.[locale] ?? item.name);
  const description =
    (onlineItem?.displayDescription?.[locale] ?? onlineItem?.displayDescription?.["zh-CN"]) ||
    (item.displayDescription?.[locale] ?? item.description);

  const installTask = useInstallProgressStore((state) => state.tasks[item.id]);
  const { setProgress, clearProgress } = useInstallProgressStore();
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // 复制 Identifier
  const handleCopyIdentifier = () => {
    navigator.clipboard.writeText(item.id);
    setIsCopiedId(true);
    showToast("已复制插件唯一标识符", "info");
    setTimeout(() => setIsCopiedId(false), 2000);
  };

  // 4. 执行实际安装（异步非阻塞，消除掉帧）
  const executeInstall = async () => {
    if (isInstalling) return;
    setIsInstalling(true);
    setProgress(item.id, "preparing", 5, "正在准备安装环境...");

    // 让出主线程微任务，避免 UI 瞬态卡顿
    await new Promise((resolve) => setTimeout(resolve, 30));

    try {
      if (item.kind === "lsp" || item.id.startsWith("auronalabs.lsp-")) {
        await MarketplaceService.installLspServer(item.id, item.version, (percentage, stage) => {
          const msg = stage === "downloading" ? "正在下载语言服务..." : "正在解压部署...";
          setProgress(item.id, "downloading", percentage, msg);
        });
        setProgress(item.id, "completed", 100, "安装完成");
        showToast(`语言服务已安装就绪: ${title}`, "success");
      } else {
        setProgress(item.id, "downloading", 40, "正在下载扩展包...");
        await MarketplaceService.installExtension(item.id, item.version);
        setProgress(item.id, "completed", 100, "安装完成");
        showToast(`扩展已安装: ${title}`, "success");
      }
      startTransition(() => {
        void refreshExtensions();
      });
      setTimeout(() => clearProgress(item.id), 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "扩展操作失败";
      setProgress(item.id, "failed", 0, message);
      showToast(message, "warning");
      setTimeout(() => clearProgress(item.id), 3000);
    } finally {
      setIsInstalling(false);
    }
  };

  // 安装或卸载分发
  const handleInstallOrUninstall = async () => {
    if (isInstalling) return;

    if (item.installed && !item.updateAvailable) {
      setIsInstalling(true);
      // 异步解耦卸载流程，消除大文件递归删除造成的卡顿
      setTimeout(async () => {
        try {
          if (item.kind === "lsp" || item.id.startsWith("auronalabs.lsp-")) {
            await MarketplaceService.uninstallLspServer(item.id);
          } else {
            await MarketplaceService.uninstallExtension(item.id);
          }
          showToast("扩展已成功卸载", "info");
          startTransition(() => {
            void refreshExtensions();
          });
        } catch (error) {
          showToast(error instanceof Error ? error.message : "卸载失败", "warning");
        } finally {
          setIsInstalling(false);
        }
      }, 30);
      return;
    }

    // 安装前检测 Node.js 运行时
    const isLsp = item.kind === "lsp" || item.id.startsWith("auronalabs.lsp-");
    const reqRuntime = item.lspMetadata?.runtimeType || "node";

    let hasNode = false;
    try {
      const toolchains = await LanguageServerIPC.listToolchains();
      hasNode = toolchains.runtimes.some((r) => r.runtimeType === "node");
    } catch {
      // 忽略
    }

    if (isLsp && reqRuntime === "node" && !hasNode) {
      setConfirmModalOpen(true);
      return;
    }

    void executeInstall();
  };

  // 5. 切换星标
  const handleToggleStar = async () => {
    if (isStarring) return;
    setIsStarring(true);
    try {
      const res = await MarketplaceService.toggleStar(item.id);
      setIsStarred(res.isStarred);
      showToast(res.isStarred ? t("extensions.starred") : "已取消收藏", "success");
    } catch {
      showToast("操作失败", "warning");
    } finally {
      setIsStarring(false);
    }
  };

  // 6. 提交评价
  const handleSubmitReview = async () => {
    if (!newReviewBody.trim()) {
      showToast("请填写评价内容", "warning");
      return;
    }
    setIsSubmittingReview(true);
    try {
      const res = await MarketplaceService.submitReview(item.id, newReviewRating, newReviewBody);
      if (res.success) {
        showToast(t("extensions.reviewSuccess"), "success");
        setNewReviewBody("");
        const updated = await MarketplaceService.fetchReviews(item.id);
        if (updated) {
          startTransition(() => {
            setReviewsData(updated);
          });
        }
      } else {
        showToast(res.message || "提交评价失败", "warning");
      }
    } catch {
      showToast("提交评价发生异常", "warning");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // 7. 点赞评价
  const handleHelpful = async (reviewId: string) => {
    try {
      const res = await MarketplaceService.markReviewHelpful(item.id, reviewId);
      if (res.success) {
        setReviewsData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            data: prev.data.map((r) =>
              r.id === reviewId ? { ...r, helpfulCount: (r.helpfulCount || 0) + 1 } : r,
            ),
          };
        });
        showToast("已标记为有帮助", "success");
      }
    } catch {
      // 忽略
    }
  };

  // 格式化下载量
  const formattedDownloads = useMemo(() => {
    if (!item.downloads || item.downloads === 0) {
      return t("extensions.noDownloads");
    }
    if (item.downloads >= 10000) {
      return `${(item.downloads / 10000).toFixed(1)}w`;
    }
    if (item.downloads >= 1000) {
      return `${(item.downloads / 1000).toFixed(1)}k`;
    }
    return String(item.downloads);
  }, [item.downloads, t]);

  return (
    <div className="flex flex-col h-full w-full bg-[var(--color-surface-1)] text-[var(--color-text-primary)] overflow-y-auto select-none">
      {/* 顶部 Hero 区域：高对比度现代微拟物毛玻璃底衬 */}
      <div className="border-b border-[var(--border-subtle)] bg-[var(--color-surface-2)]/95 px-8 py-8 backdrop-blur-xl shadow-xs relative">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
          {/* 左侧：大图标与核心元数据 */}
          <div className="flex items-start gap-5 min-w-0">
            <div className="size-22 shrink-0 rounded-2xl bg-gradient-to-br from-[var(--color-surface-3)] to-[var(--color-surface-2)] border border-[var(--border-subtle)] flex items-center justify-center shadow-lg overflow-hidden p-2.5 transition-all hover:scale-105 duration-200">
              <ExtensionIcon icon={item.icon} name={title} size={58} />
            </div>

            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[24px] font-extrabold tracking-tight text-[var(--color-text-highlight)] truncate select-text">
                  {title}
                </h1>
                {item.verified && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2.5 py-0.5 rounded-full shadow-xs">
                    <Icons.Check size={12} stroke={2.5} />
                    {t("extensions.officialVerified")}
                  </span>
                )}
                <Tooltip content="点击复制扩展 ID" delay={300}>
                  <button
                    type="button"
                    onClick={handleCopyIdentifier}
                    className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] bg-[var(--color-surface-3)] hover:bg-[var(--color-surface-3)]/80 px-2.5 py-0.5 rounded-lg border border-[var(--border-subtle)] transition-all cursor-pointer shadow-xs active:scale-95"
                  >
                    <span>{item.id}</span>
                    {isCopiedId ? (
                      <Icons.Check size={11} className="text-green-400" />
                    ) : (
                      <Icons.Copy size={11} />
                    )}
                  </button>
                </Tooltip>
              </div>

              <p className="text-[13.5px] text-[var(--color-text-primary)] leading-relaxed max-w-2xl font-normal opacity-90">
                {description}
              </p>

              {/* 徽标胶囊行 */}
              <div className="flex items-center gap-3 pt-1 flex-wrap text-[11.5px] text-[var(--color-text-muted)]">
                {item.kind === "runtime" ? (
                  <span className="flex items-center gap-1.5 font-medium text-[var(--color-text-primary)]">
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 font-semibold shadow-xs">
                      {t("extensions.systemRuntimePublisher")}
                    </span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-medium text-[var(--color-text-primary)] bg-[var(--color-surface-3)]/60 px-2.5 py-0.5 rounded-full border border-[var(--border-subtle)] shadow-xs">
                    <span className="text-[var(--color-text-muted)] font-normal">
                      {t("extensions.publisher")}:
                    </span>
                    <AccountAvatar
                      name={item.publisher}
                      picture={item.publisherAvatar ?? null}
                      size={15}
                      className="shadow-xs"
                    />
                    <span>{item.publisher}</span>
                  </span>
                )}
                <span className="opacity-30">•</span>
                <span className="font-mono bg-[var(--color-surface-3)]/60 px-2 py-0.5 rounded-md border border-[var(--border-subtle)]">
                  {t("extensions.version")} v{item.version}
                </span>
                <span className="opacity-30">•</span>
                <span className="flex items-center gap-1 text-amber-400 font-semibold bg-[var(--color-surface-3)]/60 px-2.5 py-0.5 rounded-full border border-[var(--border-subtle)]">
                  {item.reviewCount && item.reviewCount > 0 ? (
                    <>
                      <Icons.Sparkles size={12} className="fill-amber-400" />
                      {item.rating.toFixed(1)} ({item.reviewCount})
                    </>
                  ) : (
                    <span className="text-[var(--color-text-muted)] font-normal">暂未评级</span>
                  )}
                </span>
                <span className="opacity-30">•</span>
                <span className="flex items-center gap-1 text-[var(--color-text-muted)] bg-[var(--color-surface-3)]/60 px-2.5 py-0.5 rounded-full border border-[var(--border-subtle)]">
                  <Icons.Download size={12} />
                  {formattedDownloads}
                </span>
                <span className="opacity-30">•</span>
                <span className="px-2.5 py-0.5 rounded-full bg-[var(--color-surface-3)] border border-[var(--border-subtle)] font-medium">
                  {item.category}
                </span>
              </div>
            </div>
          </div>

          {/* 右侧：安装 / 更新 / 卸载 与 收藏按钮 */}
          <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
            {/* 收藏按钮 */}
            <Button
              variant="secondary"
              size="default"
              className={`h-10 px-4 text-[13px] rounded-xl font-medium shadow-xs flex items-center gap-2 transition-all cursor-pointer ${
                isStarred ? "text-amber-400 border-amber-500/30 bg-amber-500/10" : ""
              }`}
              onClick={handleToggleStar}
              disabled={isStarring}
            >
              <Icons.Sparkles
                size={14}
                className={isStarred ? "fill-amber-400 text-amber-400" : ""}
              />
              <span>{isStarred ? t("extensions.starred") : t("extensions.star")}</span>
            </Button>

            {/* 安装 / 更新 / 卸载 状态控制 */}
            {isInstalling ? (
              <Button
                variant="secondary"
                size="default"
                className="h-10 px-7 text-[13px] rounded-xl font-medium shadow-md flex items-center gap-2 opacity-80 cursor-wait"
                disabled
              >
                <Icons.Refresh size={14} className="animate-spin text-blue-400" />
                正在处理...
              </Button>
            ) : item.updateAvailable ? (
              <div className="flex items-center gap-2.5">
                <Button
                  variant="primary"
                  size="default"
                  className="h-10 px-6 text-[13px] rounded-xl font-medium shadow-md flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 border-none transition-all"
                  onClick={handleInstallOrUninstall}
                >
                  <Icons.ArrowUp size={14} />
                  更新至 v{item.version}
                </Button>
                <Button
                  variant="secondary"
                  size="default"
                  className="h-10 px-4 text-[13px] rounded-xl font-medium shadow-xs flex items-center gap-1.5 text-red-400 hover:text-red-300 border-red-500/20 hover:bg-red-500/10 transition-colors"
                  onClick={() => {
                    void (async () => {
                      if (isInstalling) return;
                      setIsInstalling(true);
                      try {
                        if (item.kind === "lsp" || item.id.startsWith("auronalabs.lsp-")) {
                          await MarketplaceService.uninstallLspServer(item.id);
                        } else {
                          await MarketplaceService.uninstallExtension(item.id);
                        }
                        showToast("扩展已卸载", "info");
                        startTransition(() => {
                          void refreshExtensions();
                        });
                      } catch (error) {
                        showToast(error instanceof Error ? error.message : "卸载失败", "warning");
                      } finally {
                        setIsInstalling(false);
                      }
                    })();
                  }}
                >
                  <Icons.Trash size={14} />
                  卸载
                </Button>
              </div>
            ) : item.installed ? (
              <Button
                variant="secondary"
                size="default"
                className="h-10 px-7 text-[13px] rounded-xl font-medium shadow-xs flex items-center gap-2 text-red-400 hover:text-red-300 border-red-500/20 hover:bg-red-500/10 transition-all cursor-pointer"
                onClick={handleInstallOrUninstall}
              >
                <Icons.Trash size={14} />
                卸载
              </Button>
            ) : (
              <Button
                variant="primary"
                size="default"
                className="h-10 px-7 text-[13px] rounded-xl font-medium shadow-md flex items-center gap-2 bg-blue-600 hover:bg-blue-500 transition-all cursor-pointer"
                onClick={handleInstallOrUninstall}
              >
                <Icons.Download size={14} />
                {t("extensions.install")}
              </Button>
            )}
          </div>
        </div>

        {/* 现代圆角长条流光进度条 */}
        {installTask && installTask.stage !== "completed" && installTask.stage !== "failed" && (
          <div className="max-w-6xl mx-auto mt-5 pt-5 border-t border-[var(--border-subtle)] animate-in fade-in duration-200 relative z-10">
            <div className="flex items-center justify-between text-[12.5px] mb-2">
              <span className="text-blue-400 font-medium flex items-center gap-2">
                <Icons.Refresh size={13} className="animate-spin text-blue-400" />
                {installTask.message || "正在处理安装任务..."}
              </span>
              <span className="font-mono text-blue-400 font-bold text-[12.5px]">
                {Math.round(installTask.progress)}%
              </span>
            </div>
            <div className="h-2.5 w-full bg-[var(--color-surface-3)] rounded-full overflow-hidden border border-[var(--border-subtle)]/80 shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-400 rounded-full transition-all duration-150 shadow-sm"
                style={{ width: `${Math.max(4, installTask.progress)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 附带依赖安装确认弹窗 */}
      <DependencyConfirmModal
        isOpen={confirmModalOpen}
        targetName={title}
        targetVersion={item.version}
        targetType={item.kind === "lsp" ? "lsp" : "extension"}
        dependencies={[
          {
            name: "Node.js 官方公共基础运行时",
            version: "22.22.0",
            size: "88.2 MB",
            type: "runtime",
            description: "官方共享执行环境，用于运行 TypeScript、Pyright 等前端语言服务",
          },
        ]}
        onConfirm={() => {
          setConfirmModalOpen(false);
          void executeInstall();
        }}
        onCancel={() => setConfirmModalOpen(false)}
      />

      {/* 主体双栏区域 (7:3 现代布局) */}
      <div className="max-w-6xl w-full mx-auto p-8 flex flex-col md:flex-row gap-8 flex-1">
        {/* 左侧主内容区 (70%) */}
        <div className="flex-1 flex flex-col gap-6 min-w-0">
          {/* SubTab 现代拟物导航条 */}
          <div className="flex items-center gap-1.5 p-1 bg-[var(--color-surface-2)]/60 rounded-2xl border border-[var(--border-subtle)]/70 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setActiveSubTab("details")}
              className={`flex-1 py-2 px-4 rounded-xl text-[13px] font-medium transition-all cursor-pointer text-center outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0 select-none border-none ${
                activeSubTab === "details"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t("extensions.detailsTab")}
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab("features")}
              className={`flex-1 py-2 px-4 rounded-xl text-[13px] font-medium transition-all cursor-pointer text-center outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0 select-none border-none ${
                activeSubTab === "features"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t("extensions.featuresTab")}
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab("changelog")}
              className={`flex-1 py-2 px-4 rounded-xl text-[13px] font-medium transition-all cursor-pointer text-center outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0 select-none border-none ${
                activeSubTab === "changelog"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t("extensions.changelogTab")}
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab("reviews")}
              className={`flex-1 py-2 px-4 rounded-xl text-[13px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0 select-none border-none ${
                activeSubTab === "reviews"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              <span>{t("extensions.reviewsTab")}</span>
              {reviewsData && reviewsData.total > 0 && (
                <span className="px-2 py-0.2 rounded-full text-[10.5px] bg-blue-500/20 text-blue-400 font-semibold">
                  {reviewsData.total}
                </span>
              )}
            </button>
          </div>

          {/* 1. 详细介绍 Tab */}
          {activeSubTab === "details" && (
            <div className="flex flex-col gap-6 leading-relaxed text-[13.5px] animate-in fade-in duration-200">
              {/* README 区域 */}
              {item.readme ? (
                <Card className="p-8 rounded-3xl shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
                  <MarkdownRenderer content={item.readme} />
                </Card>
              ) : (
                <Card className="p-8 rounded-3xl flex flex-col gap-3.5 shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
                  <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
                    {t("extensions.aboutExtension")}
                  </h3>
                  <MarkdownRenderer content={description || t("extensions.defaultDescription")} />
                  <p className="text-[12.5px] text-[var(--color-text-muted)] border-t border-[var(--border-subtle)] pt-3.5 mt-1">
                    {t("extensions.defaultSdkSummary")}
                  </p>
                </Card>
              )}

              {/* 权限清单展示 */}
              <Card className="p-8 rounded-3xl flex flex-col gap-4 shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)] flex items-center gap-2">
                    <Icons.Check size={16} className="text-blue-400" />
                    {t("extensions.permissionsRequired")}
                  </h3>
                  <span className="text-[11px] text-[var(--color-text-muted)] font-mono bg-[var(--color-surface-3)] px-2.5 py-1 rounded-md border border-[var(--border-subtle)]">
                    WASI 0.2 Component Model
                  </span>
                </div>

                {item.permissions && item.permissions.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
                    {item.permissions.map((perm) => {
                      const isSensitive = perm.level === "sensitive" || perm.level === "critical";
                      return (
                        <div
                          key={perm.id}
                          className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--color-surface-3)]/40 flex flex-col gap-1.5 shadow-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-[13px] text-[var(--color-text-highlight)]">
                              {perm.name}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${
                                isSensitive
                                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                  : "bg-green-500/10 text-green-400 border border-green-500/20"
                              }`}
                            >
                              {perm.level}
                            </span>
                          </div>
                          <p className="text-[11.5px] text-[var(--color-text-secondary)] leading-relaxed">
                            {perm.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[12.5px] text-[var(--color-text-muted)] py-1">
                    {t("extensions.noPermissionsRequired")}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* 2. 功能特性 Tab */}
          {activeSubTab === "features" && (
            <Card className="p-8 rounded-3xl flex flex-col gap-5 text-[13.5px] shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md animate-in fade-in duration-200">
              <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
                {t("extensions.featuresTab")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-[var(--color-surface-3)]/40 border border-[var(--border-subtle)] flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-blue-400 font-semibold text-[13.5px]">
                    <Icons.ShieldCheck size={16} />
                    <span>WASI 0.2 沙箱强隔离</span>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
                    基于 WebAssembly Component Model
                    运行，内存严格线性隔离，保障宿主数据与环境安全。
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-[var(--color-surface-3)]/40 border border-[var(--border-subtle)] flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-indigo-400 font-semibold text-[13.5px]">
                    <Icons.Palette size={16} />
                    <span>原生主题色彩自适应</span>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
                    深度感知工作台微拟物毛玻璃与高对比度模式，与整体桌面界面体验浑然一体。
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-[var(--color-surface-3)]/40 border border-[var(--border-subtle)] flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-[13.5px]">
                    <Icons.Sparkles size={16} />
                    <span>零冗余极速加载</span>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
                    无多余网络与进程开销，毫秒级热启动与轻量化后台状态调度。
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-[var(--color-surface-3)]/40 border border-[var(--border-subtle)] flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-amber-400 font-semibold text-[13.5px]">
                    <Icons.Command size={16} />
                    <span>工作区独立状态隔离</span>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
                    支持快捷命令面板一键唤起与多工作区独立的配置持久化。
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* 3. 更新日志与版本历史 Tab */}
          {activeSubTab === "changelog" && (
            <div className="flex flex-col gap-6 animate-in fade-in duration-200">
              {item.changelog ? (
                <Card className="p-8 rounded-3xl shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
                  <MarkdownRenderer content={item.changelog} />
                </Card>
              ) : (
                <Card className="p-8 rounded-3xl flex flex-col gap-3 text-[13.5px] shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
                  <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
                    {t("extensions.changelogTab")}
                  </h3>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="font-semibold text-blue-400 font-mono">v{item.version}</span>
                    <span className="text-[12px] text-[var(--color-text-muted)]">(当前最新版)</span>
                  </div>
                  <p className="text-[var(--color-text-secondary)]">
                    正式版本发布，已完整接入 Aurona Code 标准扩展与语言服务规范。
                  </p>
                </Card>
              )}

              {/* 历史版本列表 */}
              {item.publishedVersions && item.publishedVersions.length > 0 && (
                <Card className="p-8 rounded-3xl flex flex-col gap-4 shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
                  <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                    {t("extensions.versionHistory")}
                  </h3>
                  <div className="divide-y divide-[var(--border-subtle)] text-[12.5px]">
                    {item.publishedVersions.map((v) => (
                      <div key={v.version} className="py-3.5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-semibold text-blue-400 text-[13px]">
                            v{v.version}
                          </span>
                          {v.publishedAt && (
                            <span className="text-[11.5px] text-[var(--color-text-muted)]">
                              {v.publishedAt.split("T")[0]}
                            </span>
                          )}
                          {v.fileSizeFormatted && (
                            <span className="text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface-3)] px-2 py-0.5 rounded-md border border-[var(--border-subtle)] font-mono">
                              {v.fileSizeFormatted}
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-[12px] rounded-xl hover:bg-[var(--color-surface-3)]"
                          onClick={() => {
                            void MarketplaceService.getDownloadUrl(item.id, v.version).then(
                              (url) => {
                                window.open(url, "_blank");
                              },
                            );
                          }}
                        >
                          <Icons.Download size={12} className="mr-1.5 inline" />
                          下载安装包
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* 4. 用户评价与反馈 Tab */}
          {activeSubTab === "reviews" && (
            <div className="flex flex-col gap-6 animate-in fade-in duration-200">
              {/* 评价表单卡片 */}
              <Card className="p-8 rounded-3xl flex flex-col gap-4 shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
                <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
                  {t("extensions.writeReview")}
                </h3>
                {/* 星级打分选择 */}
                <div className="flex items-center gap-2.5">
                  <span className="text-[12.5px] text-[var(--color-text-muted)]">评分：</span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setNewReviewRating(star)}
                        className="p-1 rounded-lg hover:scale-125 transition-transform cursor-pointer"
                      >
                        <Icons.Sparkles
                          size={20}
                          className={
                            star <= newReviewRating
                              ? "text-amber-400 fill-amber-400 drop-shadow-xs"
                              : "text-[var(--color-text-muted)] opacity-30"
                          }
                        />
                      </button>
                    ))}
                  </div>
                  <span className="text-[12px] font-bold text-amber-400 ml-1.5 font-mono">
                    {newReviewRating} 星
                  </span>
                </div>

                {/* 评价内容输入 */}
                <textarea
                  value={newReviewBody}
                  onChange={(e) => setNewReviewBody(e.target.value)}
                  placeholder={t("extensions.reviewPlaceholder")}
                  rows={3}
                  className="w-full p-4 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--border-subtle)] text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500/50 resize-none transition-all shadow-inner"
                />

                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-9 px-6 rounded-xl text-[12.5px] font-medium bg-blue-600 hover:bg-blue-500 shadow-sm"
                    onClick={handleSubmitReview}
                    disabled={isSubmittingReview}
                  >
                    {isSubmittingReview ? "提交中..." : t("extensions.submitReview")}
                  </Button>
                </div>
              </Card>

              {/* 现有评价列表 */}
              <Card className="p-8 rounded-3xl flex flex-col gap-4 shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3.5">
                  <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                    {t("extensions.reviewsTitle")} ({reviewsData?.total || 0})
                  </h3>
                  <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[13.5px]">
                    <Icons.Sparkles size={14} className="fill-amber-400" />
                    <span className="font-mono">
                      {item.reviewCount && item.reviewCount > 0
                        ? `${item.rating.toFixed(1)} / 5.0`
                        : "暂未评级"}
                    </span>
                  </div>
                </div>

                {!reviewsData || reviewsData.data.length === 0 ? (
                  <div className="p-10 text-center text-[12.5px] text-[var(--color-text-muted)]">
                    {t("extensions.noReviews")}
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                    {reviewsData.data.map((rev: ReviewItem) => (
                      <div key={rev.id} className="py-4.5 flex flex-col gap-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <AccountAvatar
                              name={rev.userName}
                              picture={rev.userAvatar ?? null}
                              size={24}
                              className="shadow-xs"
                            />
                            <span className="font-semibold text-[13px] text-[var(--color-text-highlight)]">
                              {rev.userName}
                            </span>
                            <div className="flex items-center gap-0.5 text-amber-400">
                              {[1, 2, 3, 4, 5].slice(0, rev.rating).map((starNum) => (
                                <Icons.Sparkles
                                  key={`${rev.id}-star-${starNum}`}
                                  size={11}
                                  className="fill-amber-400"
                                />
                              ))}
                            </div>
                          </div>
                          <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                            {rev.createdAt.split("T")[0]}
                          </span>
                        </div>

                        <p className="text-[12.5px] text-[var(--color-text-secondary)] leading-relaxed pl-9">
                          {rev.body}
                        </p>

                        {/* 官方/开发者回复 */}
                        {rev.reply && (
                          <div className="ml-9 mt-1.5 p-3.5 rounded-2xl bg-[var(--color-surface-3)]/60 border border-[var(--border-subtle)] flex flex-col gap-1 text-[11.5px] shadow-xs">
                            <span className="font-semibold text-blue-400">开发者回复：</span>
                            <span className="text-[var(--color-text-primary)]">
                              {rev.reply.body}
                            </span>
                          </div>
                        )}

                        <div className="flex justify-end pl-9">
                          <button
                            type="button"
                            onClick={() => handleHelpful(rev.id)}
                            className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-blue-400 transition-colors cursor-pointer bg-[var(--color-surface-3)]/40 px-2.5 py-1 rounded-lg border border-[var(--border-subtle)]"
                          >
                            <Icons.Check size={11} />
                            <span>
                              {t("extensions.helpful")} ({rev.helpfulCount || 0})
                            </span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>

        {/* 右侧侧边栏元数据区 (30%) */}
        <div className="w-full md:w-80 shrink-0 flex flex-col gap-6">
          {/* 1. 插件开发者卡片 */}
          <Card className="p-6 rounded-3xl flex flex-col gap-4 shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
            <h4 className="text-[12px] font-bold tracking-wider uppercase text-[var(--color-text-muted)]">
              {item.kind === "runtime"
                ? t("extensions.categoryRuntime")
                : t("extensions.developer")}
            </h4>
            {item.kind === "runtime" ? (
              <div className="flex items-center gap-3.5">
                <div className="size-11 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center shadow-xs">
                  <Icons.Terminal size={22} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold text-[13.5px] text-[var(--color-text-highlight)] truncate">
                    {t("extensions.systemRuntimePublisher")}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)] truncate">
                    官方托管 • 跨插件共享复用
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3.5">
                <div className="relative">
                  <AccountAvatar
                    name={item.publisher}
                    picture={item.publisherAvatar ?? null}
                    size={46}
                    className="shadow-sm"
                  />
                  {item.verified && (
                    <span className="absolute -bottom-1 -right-1 grid size-4.5 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--StatusSuccess)] text-white shadow-xs">
                      <Icons.Check size={11} stroke={3} />
                    </span>
                  )}
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-[14px] text-[var(--color-text-highlight)] truncate">
                      {item.publisher}
                    </span>
                    {item.verified && (
                      <span className="text-blue-400">
                        <Icons.Check size={13} stroke={2.5} />
                      </span>
                    )}
                  </div>
                  <span className="text-[11.5px] text-[var(--color-text-muted)] truncate">
                    {item.verified ? "官方认证发布者" : "社区开发者"}
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* 2. 安全与沙箱审计卡片 */}
          <Card className="p-6 rounded-3xl flex flex-col gap-3 shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <h4 className="text-[12px] font-bold tracking-wider uppercase text-[var(--color-text-muted)]">
                {t("extensions.securityScore")}
              </h4>
              <span className="text-[13.5px] font-bold text-green-400 font-mono">
                {item.securityScore == null ? "未知" : `${item.securityScore}/100`}
              </span>
            </div>
            <div className="w-full bg-[var(--color-surface-3)] h-2 rounded-full overflow-hidden shadow-inner">
              <div
                className="bg-gradient-to-r from-emerald-500 to-green-400 h-full rounded-full"
                style={{ width: `${item.securityScore ?? 100}%` }}
              />
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed pt-0.5">
              {t("extensions.securityPassed")}
            </p>
          </Card>

          {/* 3. 扩展元数据规格 */}
          <Card className="p-6 rounded-3xl flex flex-col gap-3.5 shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
            <h4 className="text-[12px] font-bold tracking-wider uppercase text-[var(--color-text-muted)]">
              {t("extensions.extensionDetails")}
            </h4>
            <div className="flex flex-col gap-3 text-[12.5px]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">{t("extensions.publisher")}</span>
                <span className="font-medium text-[var(--color-text-highlight)] flex items-center gap-1.5">
                  {item.kind === "runtime" ? (
                    <span>{t("extensions.systemRuntimePublisher")}</span>
                  ) : (
                    <>
                      <AccountAvatar
                        name={item.publisher}
                        picture={item.publisherAvatar ?? null}
                        size={15}
                      />
                      {item.publisher}
                    </>
                  )}
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
                <span className="font-mono font-medium text-[var(--color-text-highlight)]">
                  v{item.version}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">{t("extensions.category")}</span>
                <span className="font-medium text-[var(--color-text-primary)]">
                  {item.category}
                </span>
              </div>
              {item.fileSize && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--color-text-muted)]">{t("extensions.fileSize")}</span>
                  <span className="font-mono text-[11.5px] text-[var(--color-text-primary)]">
                    {item.fileSize}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">{t("extensions.license")}</span>
                <span className="font-medium text-[var(--color-text-primary)]">
                  {item.license || "MIT"}
                </span>
              </div>
            </div>
          </Card>

          {/* 4. 资源链接与 GitHub / Docs 入口 */}
          <Card className="p-6 rounded-3xl flex flex-col gap-3 text-[12.5px] shadow-sm border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 backdrop-blur-md">
            <h4 className="text-[12px] font-bold tracking-wider uppercase text-[var(--color-text-muted)] mb-0.5">
              {t("extensions.relatedResources")}
            </h4>
            <a
              href="https://github.com/AuronaLabs/AuronaCode-Early"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:text-blue-300 flex items-center gap-2.5 p-2 rounded-xl hover:bg-blue-500/10 transition-all cursor-pointer"
            >
              <Icons.Github size={15} />
              <span className="font-medium">GitHub 源码与 issue 追踪</span>
            </a>
            <a
              href="https://marketplace.aurona.cc/docs"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:text-blue-300 flex items-center gap-2.5 p-2 rounded-xl hover:bg-blue-500/10 transition-all cursor-pointer"
            >
              <Icons.FileText size={15} />
              <span className="font-medium">{t("extensions.sourceAndDocs")}</span>
            </a>
            <a
              href="https://marketplace.aurona.cc"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:text-blue-300 flex items-center gap-2.5 p-2 rounded-xl hover:bg-blue-500/10 transition-all cursor-pointer"
            >
              <Icons.Sparkles size={15} />
              <span className="font-medium">{t("extensions.marketplacePortal")}</span>
            </a>
          </Card>
        </div>
      </div>
    </div>
  );
}
