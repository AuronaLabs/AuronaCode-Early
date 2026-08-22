import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../../Foundation/I18n";
import { useExtensionStore } from "../../../State/useExtensionStore";
import { AccountAvatar } from "../../../UI/Components/AccountAvatar";
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
      if (detail) {
        setOnlineItem(detail);
      }
      if (reviews) {
        setReviewsData(reviews);
      }
      if (star) {
        setIsStarred(star.isStarred);
      }
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
    // Marketplace extensions must not fall back to a possibly stale or forged
    // package manifest when the catalog is unavailable. Local descriptors are
    // only a valid source for extensions that are not Marketplace references.
    if (localDescriptor && !localDescriptor.marketplace && !extensionId.startsWith("auronalabs.")) {
      return descriptorToMarketplaceItem(localDescriptor);
    }
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
      rating: 0,
      verified: false,
      installed: Boolean(localDescriptor),
      enabled: true,
      packageType:
        extensionId.startsWith("vscode-") || extensionId.endsWith(".vsix") ? "vsix" : "aurx",
    };
  }, [onlineItem, localDescriptor, extensionId, t]);

  const title = item.displayName?.[locale] ?? item.name;
  const description = item.displayDescription?.[locale] ?? item.description;

  const handleInstallOrUninstall = async () => {
    if (isInstalling) return;
    setIsInstalling(true);
    try {
      if (item.installed && !item.updateAvailable) {
        await MarketplaceService.uninstallExtension(item.id);
        showToast("扩展已卸载", "info");
      } else {
        await MarketplaceService.installExtension(item.id, item.version);
        showToast(`扩展已安装: ${title}`, "success");
      }
      await refreshExtensions();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "扩展操作失败", "warning");
    } finally {
      setIsInstalling(false);
    }
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
        // 重新拉取评论列表
        const updated = await MarketplaceService.fetchReviews(item.id);
        if (updated) setReviewsData(updated);
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
                <span className="flex items-center gap-1.5 font-medium text-[var(--color-text-primary)]">
                  <span className="text-[var(--color-text-muted)]">
                    {t("extensions.publisher")}:
                  </span>
                  <AccountAvatar
                    name={item.publisher}
                    picture={item.publisherAvatar ?? null}
                    size={16}
                    className="shadow-xs"
                  />
                  <span>{item.publisher}</span>
                </span>
                <span>•</span>
                <span>
                  {t("extensions.version")} {item.version}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 text-amber-400 font-semibold">
                  {item.reviewCount && item.reviewCount > 0 ? (
                    <>
                      <Icons.Sparkles size={12} />
                      {item.rating.toFixed(1)} ({item.reviewCount})
                    </>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">暂未定级</span>
                  )}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 text-[var(--color-text-muted)]">
                  <Icons.Download size={12} />
                  {item.downloads}
                </span>
                <span>•</span>
                <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface-3)] border border-[var(--border-subtle)]">
                  {item.category}
                </span>
              </div>
            </div>
          </div>

          {/* 右侧：安装/下载与收藏按钮 */}
          <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
            {/* 星标收藏 */}
            <Button
              variant="secondary"
              size="default"
              className={`h-9 px-3.5 text-[13px] rounded-xl font-medium shadow-sm flex items-center gap-1.5 transition-all ${
                isStarred ? "text-amber-400 border-amber-500/30" : ""
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

            {/* 安装 / 下载按钮 */}
            <Button
              variant="primary"
              size="default"
              className="h-9 px-6 text-[13px] rounded-xl font-medium shadow-md flex items-center gap-1.5"
              onClick={handleInstallOrUninstall}
              disabled={isInstalling}
            >
              <Icons.Download size={14} />
              {isInstalling
                ? "处理中..."
                : item.updateAvailable
                  ? "更新"
                  : item.installed
                    ? "卸载"
                    : t("extensions.install")}
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
            <button
              type="button"
              onClick={() => setActiveSubTab("reviews")}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === "reviews"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              <span>{t("extensions.reviewsTab")}</span>
              {reviewsData && reviewsData.total > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-500/20 text-blue-400">
                  {reviewsData.total}
                </span>
              )}
            </button>
          </div>

          {/* 1. 详细介绍 Tab */}
          {activeSubTab === "details" && (
            <div className="flex flex-col gap-6 leading-relaxed text-[13.5px]">
              {/* README 区域 */}
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

              {/* 权限清单展示 */}
              <Card className="p-6 rounded-2xl flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)] flex items-center gap-2">
                    <Icons.Check size={16} className="text-blue-400" />
                    {t("extensions.permissionsRequired")}
                  </h3>
                  <span className="text-[11.5px] text-[var(--color-text-muted)]">
                    WASI 0.2 Component Model
                  </span>
                </div>

                {item.permissions && item.permissions.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {item.permissions.map((perm) => {
                      const isSensitive = perm.level === "sensitive" || perm.level === "critical";
                      return (
                        <div
                          key={perm.id}
                          className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/50 flex flex-col gap-1"
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
                          <p className="text-[11.5px] text-[var(--color-text-secondary)]">
                            {perm.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[12.5px] text-[var(--color-text-muted)] py-2">
                    {t("extensions.noPermissionsRequired")}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* 2. 功能特性 Tab */}
          {activeSubTab === "features" && (
            <Card className="p-6 rounded-2xl flex flex-col gap-4 text-[13.5px]">
              <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                {t("extensions.featuresTab")}
              </h3>
              <ul className="flex flex-col gap-2.5 text-[var(--color-text-secondary)] list-disc pl-5">
                <li>基于 WASI 0.2 组件模型原生运行，沙箱内存隔离，保障宿主完全安全</li>
                <li>原生响应主题与色彩自适应切换，界面体验浑然一体</li>
                <li>无额外网络冗余依赖，轻量极速加载</li>
                <li>支持快捷命令与沉浸式侧边栏/工作区集成</li>
              </ul>
            </Card>
          )}

          {/* 3. 更新日志与版本历史 Tab */}
          {activeSubTab === "changelog" && (
            <div className="flex flex-col gap-5">
              {item.changelog ? (
                <Card className="p-6 rounded-2xl">
                  <MarkdownRenderer content={item.changelog} />
                </Card>
              ) : (
                <Card className="p-6 rounded-2xl flex flex-col gap-3 text-[13.5px]">
                  <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                    {t("extensions.changelogTab")}
                  </h3>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="font-semibold text-blue-400">v{item.version}</span>
                    <span className="text-[12px] text-[var(--color-text-muted)]">(最新发布)</span>
                  </div>
                  <p className="text-[var(--color-text-secondary)]">
                    初始化正式版构建发布，全面接入 Aurona Code SDK 标准。
                  </p>
                </Card>
              )}

              {/* 历史版本列表 */}
              {item.publishedVersions && item.publishedVersions.length > 0 && (
                <Card className="p-6 rounded-2xl flex flex-col gap-3.5">
                  <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                    {t("extensions.versionHistory")}
                  </h3>
                  <div className="divide-y divide-[var(--border-subtle)] text-[12.5px]">
                    {item.publishedVersions.map((v) => (
                      <div key={v.version} className="py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-semibold text-blue-400">
                            v{v.version}
                          </span>
                          {v.publishedAt && (
                            <span className="text-[11.5px] text-[var(--color-text-muted)]">
                              {v.publishedAt.split("T")[0]}
                            </span>
                          )}
                          {v.fileSizeFormatted && (
                            <span className="text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface-3)] px-2 py-0.5 rounded">
                              {v.fileSizeFormatted}
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11.5px]"
                          onClick={() => {
                            void MarketplaceService.getDownloadUrl(item.id, v.version).then(
                              (url) => {
                                window.open(url, "_blank");
                              },
                            );
                          }}
                        >
                          <Icons.Download size={12} className="mr-1 inline" />
                          下载
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
            <div className="flex flex-col gap-6">
              {/* 评价表单卡片 */}
              <Card className="p-6 rounded-2xl flex flex-col gap-4">
                <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                  {t("extensions.writeReview")}
                </h3>
                {/* 星级打分选择 */}
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] text-[var(--color-text-muted)]">评分：</span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setNewReviewRating(star)}
                        className="p-1 rounded hover:scale-110 transition-transform cursor-pointer"
                      >
                        <Icons.Sparkles
                          size={18}
                          className={
                            star <= newReviewRating
                              ? "text-amber-400 fill-amber-400"
                              : "text-[var(--color-text-muted)] opacity-40"
                          }
                        />
                      </button>
                    ))}
                  </div>
                  <span className="text-[12px] font-semibold text-amber-400 ml-1">
                    {newReviewRating} 星
                  </span>
                </div>

                {/* 评价内容输入 */}
                <textarea
                  value={newReviewBody}
                  onChange={(e) => setNewReviewBody(e.target.value)}
                  placeholder={t("extensions.reviewPlaceholder")}
                  rows={3}
                  className="w-full p-3 rounded-xl bg-[var(--color-surface-2)]/80 border border-[var(--border-subtle)] text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500/50 resize-none transition-colors"
                />

                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-8 px-5 rounded-xl text-[12px]"
                    onClick={handleSubmitReview}
                    disabled={isSubmittingReview}
                  >
                    {isSubmittingReview ? "提交中..." : t("extensions.submitReview")}
                  </Button>
                </div>
              </Card>

              {/* 现有评价列表 */}
              <Card className="p-6 rounded-2xl flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                  <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">
                    {t("extensions.reviewsTitle")} ({reviewsData?.total || 0})
                  </h3>
                  <div className="flex items-center gap-1 text-amber-400 font-semibold text-[13px]">
                    <Icons.Sparkles size={14} className="fill-amber-400" />
                    <span>
                      {item.reviewCount && item.reviewCount > 0
                        ? `${item.rating.toFixed(1)} / 5.0`
                        : "暂未定级"}
                    </span>
                  </div>
                </div>

                {!reviewsData || reviewsData.data.length === 0 ? (
                  <div className="p-8 text-center text-[12.5px] text-[var(--color-text-muted)]">
                    {t("extensions.noReviews")}
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                    {reviewsData.data.map((rev: ReviewItem) => (
                      <div key={rev.id} className="py-4 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <AccountAvatar
                              name={rev.userName}
                              picture={rev.userAvatar ?? null}
                              size={22}
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
                          <span className="text-[11px] text-[var(--color-text-muted)]">
                            {rev.createdAt.split("T")[0]}
                          </span>
                        </div>

                        <p className="text-[12.5px] text-[var(--color-text-secondary)] leading-relaxed pl-8">
                          {rev.body}
                        </p>

                        {/* 官方/开发者回复 */}
                        {rev.reply && (
                          <div className="ml-8 mt-1.5 p-3 rounded-xl bg-[var(--color-surface-3)]/60 border border-[var(--border-subtle)] flex flex-col gap-1 text-[11.5px]">
                            <span className="font-semibold text-blue-400">开发者回复：</span>
                            <span className="text-[var(--color-text-primary)]">
                              {rev.reply.body}
                            </span>
                          </div>
                        )}

                        <div className="flex justify-end pl-8">
                          <button
                            type="button"
                            onClick={() => handleHelpful(rev.id)}
                            className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-blue-400 transition-colors cursor-pointer"
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
        <div className="w-full md:w-80 shrink-0 flex flex-col gap-5">
          {/* 1. 插件开发者专属卡片 */}
          <Card className="p-4 rounded-2xl flex flex-col gap-3">
            <h4 className="text-[12.5px] font-bold tracking-wider uppercase text-[var(--color-text-muted)]">
              {t("extensions.developer")}
            </h4>
            <div className="flex items-center gap-3">
              <div className="relative">
                <AccountAvatar
                  name={item.publisher}
                  picture={item.publisherAvatar ?? null}
                  size={42}
                  className="shadow-sm"
                />
                {item.verified && (
                  <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--StatusSuccess)] text-white shadow-xs">
                    <Icons.Check size={10} stroke={3} />
                  </span>
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[13.5px] text-[var(--color-text-highlight)] truncate">
                    {item.publisher}
                  </span>
                  {item.verified && (
                    <span className="text-blue-400">
                      <Icons.Check size={13} stroke={2.5} />
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[var(--color-text-muted)] truncate">
                  {item.verified ? "官方认证发布者" : "社区插件开发者"}
                </span>
              </div>
            </div>
          </Card>

          {/* 2. 安全与沙箱审计卡片 */}
          <Card className="p-4 rounded-2xl flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-[12.5px] font-bold tracking-wider uppercase text-[var(--color-text-muted)]">
                {t("extensions.securityScore")}
              </h4>
              <span className="text-[13px] font-bold text-green-400">
                {item.securityScore == null ? "未知" : `${item.securityScore}/100`}
              </span>
            </div>
            <div className="w-full bg-[var(--color-surface-3)] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-500 to-green-400 h-full rounded-full"
                style={{ width: `${item.securityScore ?? 0}%` }}
              />
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed pt-0.5">
              {t("extensions.securityPassed")}
            </p>
          </Card>

          {/* 3. 扩展元数据卡片 */}
          <Card className="p-4 rounded-2xl flex flex-col gap-3">
            <h4 className="text-[12.5px] font-bold tracking-wider uppercase text-[var(--color-text-muted)]">
              {t("extensions.extensionDetails")}
            </h4>
            <div className="flex flex-col gap-2.5 text-[12.5px]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">{t("extensions.publisher")}</span>
                <span className="font-medium text-[var(--color-text-highlight)] flex items-center gap-1.5">
                  <AccountAvatar
                    name={item.publisher}
                    picture={item.publisherAvatar ?? null}
                    size={15}
                  />
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
                  {item.license || "未知"}
                </span>
              </div>
            </div>
          </Card>

          {/* 4. 资源链接 */}
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
