import { useCallback, useEffect, useState } from "react";
import { EventBus } from "../../../Foundation/EventBus";
import { type I18nKey, useLocale } from "../../../Foundation/I18n";
import { useExtensionStore } from "../../../State/useExtensionStore";
import { useInstallProgressStore } from "../../../State/useInstallProgressStore";
import { AccountAvatar } from "../../../UI/Components/AccountAvatar";
import { Button } from "../../../UI/Components/Button";
import { MarkdownRenderer } from "../../../UI/Components/MarkdownRenderer";
import { showToast } from "../../../UI/Feedback/Toast";
import { Icons } from "../../../UI/Icons/IconManager";
import { canonicalExtensionId } from "../ExtensionId";
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

type OptionalSection = "changelog" | "reviews" | "versions";
type OptionalStatus = "idle" | "loading" | "ready" | "empty" | "error";

interface OptionalState {
  status: OptionalStatus;
  reviews?: ReviewsResponse | null;
  detail?: MarketplaceExtensionItem | null;
}

export function MarketplaceDetailPage({ extensionId }: MarketplaceDetailPageProps) {
  const { t, locale } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);
  const refreshExtensions = useExtensionStore((state) => state.refresh);
  const canonicalId = canonicalExtensionId(extensionId);
  const localDescriptor = descriptors.find(
    (descriptor) => canonicalExtensionId(descriptor.id) === canonicalId,
  );
  const [item, setItem] = useState<MarketplaceExtensionItem | null>(
    localDescriptor ? descriptorToMarketplaceItem(localDescriptor) : null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<"overview" | OptionalSection>("overview");
  const [optional, setOptional] = useState<Record<OptionalSection, OptionalState>>({
    changelog: { status: "idle" },
    reviews: { status: "idle" },
    versions: { status: "idle" },
  });
  const [isInstalling, setIsInstalling] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  const [isStarring, setIsStarring] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const installTask = useInstallProgressStore((state) => state.tasks[canonicalId]);
  const { setProgress, clearProgress } = useInstallProgressStore();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void MarketplaceService.fetchExtensionDetail(canonicalId)
      .then((remote) => {
        if (cancelled) return;
        const next = remote
          ? {
              ...remote,
              id: canonicalId,
              installed: remote.installed || Boolean(localDescriptor),
              installedVersion: localDescriptor?.version,
              updateAvailable: Boolean(
                localDescriptor &&
                  MarketplaceService.isNewerVersion(remote.version, localDescriptor.version),
              ),
            }
          : localDescriptor
            ? descriptorToMarketplaceItem(localDescriptor)
            : null;
        setItem(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalId, localDescriptor]);

  const loadOptional = useCallback(
    async (section: OptionalSection) => {
      setOptional((state) => ({ ...state, [section]: { ...state[section], status: "loading" } }));
      try {
        if (section === "reviews") {
          const reviews = await MarketplaceService.fetchReviews(canonicalId);
          if (!reviews) throw new Error("Marketplace reviews are unavailable");
          setOptional((state) => ({
            ...state,
            reviews: { status: reviews.data.length > 0 ? "ready" : "empty", reviews },
          }));
          return;
        }
        const detail = await MarketplaceService.fetchExtensionDetail(canonicalId);
        if (!detail) throw new Error("Marketplace extension details are unavailable");
        const hasData =
          section === "changelog"
            ? Boolean(detail.changelog)
            : Boolean(detail.publishedVersions?.length);
        setOptional((state) => ({
          ...state,
          [section]: { status: hasData ? "ready" : "empty", detail },
        }));
      } catch {
        setOptional((state) => ({ ...state, [section]: { status: "error" } }));
      }
    },
    [canonicalId],
  );

  const selectSection = (section: "overview" | OptionalSection) => {
    setActiveSection(section);
    if (section !== "overview" && optional[section].status === "idle") void loadOptional(section);
  };

  const currentItem = item ?? {
    id: canonicalId,
    name: canonicalId,
    displayName: { "zh-CN": canonicalId, "zh-Hant": canonicalId, en: canonicalId },
    publisher: "Unknown",
    version: "0.0.0",
    description: "",
    displayDescription: { "zh-CN": "", "zh-Hant": "", en: "" },
    category: "Developer Tools",
    tags: [],
    packageType: "aurx" as const,
  };
  const title = currentItem.displayName?.[locale] ?? currentItem.name;
  const description = currentItem.displayDescription?.[locale] ?? currentItem.description;
  const isToolchain = currentItem.kind === "lsp" || currentItem.kind === "runtime";

  const handleAction = async () => {
    if (isToolchain) {
      EventBus.emit("marketplace:navigate", { mode: "toolchains", selectedId: canonicalId });
      return;
    }
    if (isInstalling) return;
    if (currentItem.installed && !currentItem.updateAvailable) {
      setIsInstalling(true);
      try {
        await MarketplaceService.uninstallExtension(canonicalId);
        showToast(t("extensions.uninstallCompleted"), "info");
        await refreshExtensions();
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : t("extensions.uninstallFailed"),
          "warning",
        );
      } finally {
        setIsInstalling(false);
      }
      return;
    }
    setIsInstalling(true);
    setProgress(canonicalId, "preparing", 5, t("extensions.installing"));
    try {
      await MarketplaceService.installExtension(canonicalId, currentItem.version);
      setProgress(canonicalId, "completed", 100, t("extensions.installCompleted"));
      await refreshExtensions();
      showToast(t("extensions.installCompleted"), "success");
      window.setTimeout(() => clearProgress(canonicalId), 1200);
    } catch (error) {
      // 言行一致：市场下载不走代理（见网络设置范围说明），失败提示附带该线索
      const base = error instanceof Error ? error.message : t("extensions.installFailed");
      const message = `${base} · ${t("extensions.installProxyHint")}`;
      setProgress(canonicalId, "failed", 0, message);
      showToast(message, "warning");
    } finally {
      setIsInstalling(false);
    }
  };

  const toggleStar = async () => {
    if (isStarring) return;
    setIsStarring(true);
    try {
      const result = await MarketplaceService.toggleStar(canonicalId);
      setIsStarred(result.isStarred);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("extensions.starFailed"), "warning");
    } finally {
      setIsStarring(false);
    }
  };

  const submitReview = async () => {
    if (!reviewBody.trim()) return;
    setIsSubmittingReview(true);
    try {
      const result = await MarketplaceService.submitReview(canonicalId, reviewRating, reviewBody);
      if (!result.success) throw new Error(result.message || t("extensions.reviewFailed"));
      setReviewBody("");
      await loadOptional("reviews");
      showToast(t("extensions.reviewSuccess"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("extensions.reviewFailed"), "warning");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-transparent text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--border-subtle)] px-6 py-5">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-surface)] border border-[var(--border-subtle)] bg-[var(--surface-raised)]">
              <ExtensionIcon icon={currentItem.icon} name={title} size={34} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-[var(--color-text-highlight)]">
                {title}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                <AccountAvatar
                  name={currentItem.publisher}
                  picture={currentItem.publisherAvatar ?? null}
                  size={14}
                />
                <span>{currentItem.publisher}</span>
                <span>·</span>
                <span className="font-mono">v{currentItem.version}</span>
                <span>·</span>
                <span>{currentItem.category}</span>
              </div>
              <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-[var(--color-text-secondary)]">
                {description || t("extensions.defaultDescription")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={toggleStar}
              disabled={isStarring}
              aria-pressed={isStarred}
            >
              <Icons.Sparkles
                size={14}
                className={
                  isStarred ? "fill-[var(--StatusWarning)] text-[var(--StatusWarning)]" : ""
                }
              />
              {isStarred ? t("extensions.starred") : t("extensions.star")}
            </Button>
            <Button
              size="sm"
              variant={currentItem.installed ? "secondary" : "primary"}
              onClick={() => void handleAction()}
              disabled={isLoading || isInstalling}
            >
              {isToolchain
                ? t("extensions.openToolchains")
                : currentItem.updateAvailable
                  ? t("extensions.update")
                  : currentItem.installed
                    ? t("extensions.uninstall")
                    : t("extensions.install")}
            </Button>
          </div>
        </div>
        {installTask && installTask.stage !== "completed" && installTask.stage !== "failed" && (
          <div className="mx-auto mt-4 flex max-w-5xl items-center gap-3 text-[11px] text-[var(--color-accent)]">
            <Icons.Refresh size={13} className="animate-spin" />
            <span>{installTask.message}</span>
            <span className="font-mono">{Math.round(installTask.progress)}%</span>
          </div>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-6 py-5">
        <nav
          className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]"
          aria-label={t("extensions.marketplaceTitle")}
        >
          <DetailTab
            active={activeSection === "overview"}
            onClick={() => selectSection("overview")}
          >
            {t("extensions.detailsTab")}
          </DetailTab>
          <DetailTab
            active={activeSection === "changelog"}
            onClick={() => selectSection("changelog")}
          >
            {t("extensions.changelogTab")}
          </DetailTab>
          <DetailTab active={activeSection === "reviews"} onClick={() => selectSection("reviews")}>
            {t("extensions.reviewsTab")}
          </DetailTab>
          <DetailTab
            active={activeSection === "versions"}
            onClick={() => selectSection("versions")}
          >
            {t("extensions.versionHistory")}
          </DetailTab>
        </nav>

        {activeSection === "overview" && (
          <OverviewSection item={currentItem} description={description} t={t} />
        )}
        {activeSection === "changelog" && (
          <OptionalSectionView
            state={optional.changelog}
            onRetry={() => void loadOptional("changelog")}
            empty={t("extensions.noChangelog")}
            t={t}
          >
            <MarkdownRenderer content={optional.changelog.detail?.changelog ?? ""} />
          </OptionalSectionView>
        )}
        {activeSection === "versions" && (
          <OptionalSectionView
            state={optional.versions}
            onRetry={() => void loadOptional("versions")}
            empty={t("extensions.noVersions")}
            t={t}
          >
            <VersionList item={optional.versions.detail ?? currentItem} />
          </OptionalSectionView>
        )}
        {activeSection === "reviews" && (
          <ReviewSection
            state={optional.reviews}
            rating={reviewRating}
            body={reviewBody}
            submitting={isSubmittingReview}
            onRating={setReviewRating}
            onBody={setReviewBody}
            onSubmit={() => void submitReview()}
            onRetry={() => void loadOptional("reviews")}
          />
        )}
      </main>
    </div>
  );
}

function DetailTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-[12px] transition-colors ${active ? "border-[var(--color-accent)] text-[var(--color-text-highlight)]" : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)]"}`}
    >
      {children}
    </button>
  );
}

function OverviewSection({
  item,
  description,
  t,
}: {
  item: MarketplaceExtensionItem;
  description: string;
  t: (key: I18nKey) => string;
}) {
  const permissions = item.permissions ?? [];
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-6">
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
            {t("extensions.aboutExtension")}
          </h2>
          <div className="text-[13px] leading-7 text-[var(--color-text-secondary)]">
            {item.readme ? (
              <MarkdownRenderer content={item.readme} />
            ) : (
              <MarkdownRenderer content={description || t("extensions.defaultDescription")} />
            )}
          </div>
        </section>
        <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
          <h2 className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
            {t("extensions.permissionsRequired")}
          </h2>
          {permissions.length ? (
            <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
              {permissions.map((permission) => (
                <div
                  key={permission.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-[12px]"
                >
                  <span>{permission.name}</span>
                  <span className="text-[var(--color-text-muted)]">{permission.level}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              {t("extensions.noPermissionsRequired")}
            </p>
          )}
        </section>
      </div>
      <aside className="space-y-4 border-l border-[var(--border-subtle)] pl-5 text-[12px]">
        <Fact label={t("extensions.identifier")} value={item.id} mono />
        <Fact label={t("extensions.version")} value={`v${item.version}`} mono />
        <Fact
          label={t("extensions.fileSize")}
          value={item.fileSize || t("extensions.informationUnavailable")}
        />
        <Fact
          label={t("extensions.license")}
          value={item.license || t("extensions.informationUnavailable")}
        />
        {item.runtimeMetadata && (
          <>
            <Fact
              label={t("extensions.runtimeVersion")}
              value={item.runtimeMetadata.runtimeVersion || t("extensions.informationUnavailable")}
              mono
            />
            <Fact
              label={t("extensions.checksum")}
              value={item.runtimeMetadata.sha256 || t("extensions.informationUnavailable")}
              mono
            />
          </>
        )}
      </aside>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span
        className={
          mono
            ? "break-all font-mono text-[11px] text-[var(--color-text-primary)]"
            : "text-[var(--color-text-highlight)]"
        }
      >
        {value}
      </span>
    </div>
  );
}

function OptionalSectionView({
  state,
  onRetry,
  empty,
  t,
  children,
}: {
  state: OptionalState;
  onRetry: () => void;
  empty: string;
  t: (key: I18nKey) => string;
  children: React.ReactNode;
}) {
  if (state.status === "loading") {
    return (
      <div className="py-10 text-center text-[12px] text-[var(--color-text-muted)]">
        <Icons.Refresh size={18} className="mx-auto mb-2 animate-spin" />
        {t("extensions.loading")}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="space-y-3 py-10 text-center text-[12px] text-[var(--color-text-muted)]">
        <p>{t("extensions.sectionLoadFailed")}</p>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <Icons.Refresh size={13} />
          {t("extensions.retry")}
        </Button>
      </div>
    );
  }
  if (state.status === "empty") {
    return (
      <div className="py-10 text-center text-[12px] text-[var(--color-text-muted)]">{empty}</div>
    );
  }
  return (
    <section className="text-[13px] leading-7 text-[var(--color-text-secondary)]">
      {children}
    </section>
  );
}

function VersionList({ item }: { item: MarketplaceExtensionItem }) {
  return (
    <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
      {(item.publishedVersions ?? []).map((version) => (
        <div
          key={version.version}
          className="flex items-center justify-between gap-3 py-3 text-[12px]"
        >
          <span className="font-mono text-[var(--color-text-highlight)]">v{version.version}</span>
          <span className="text-[var(--color-text-muted)]">
            {version.publishedAt?.slice(0, 10) ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReviewSection({
  state,
  rating,
  body,
  submitting,
  onRating,
  onBody,
  onSubmit,
  onRetry,
}: {
  state: OptionalState;
  rating: number;
  body: string;
  submitting: boolean;
  onRating: (value: number) => void;
  onBody: (value: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  const reviews = state.reviews;
  return (
    <div className="space-y-5">
      <section className="space-y-3 border-b border-[var(--border-subtle)] pb-5">
        <h2 className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
          {t("extensions.writeReview")}
        </h2>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => onRating(value)}
              aria-label={`${value}`}
            >
              <Icons.Sparkles
                size={16}
                className={
                  value <= rating
                    ? "fill-[var(--StatusWarning)] text-[var(--StatusWarning)]"
                    : "text-[var(--color-text-muted)]"
                }
              />
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(event) => onBody(event.target.value)}
          rows={3}
          placeholder={t("extensions.reviewPlaceholder")}
          className="w-full resize-none border border-[var(--border-subtle)] bg-transparent p-3 text-[12px] outline-none focus:border-[var(--color-accent)]"
        />
        <Button size="sm" variant="primary" onClick={onSubmit} disabled={submitting}>
          {t("extensions.submitReview")}
        </Button>
      </section>
      {state.status === "loading" ? (
        <div className="py-8 text-center text-[12px] text-[var(--color-text-muted)]">
          {t("extensions.loading")}
        </div>
      ) : state.status === "error" ? (
        <div className="py-8 text-center">
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <Icons.Refresh size={13} />
            {t("extensions.retry")}
          </Button>
        </div>
      ) : !reviews?.data.length ? (
        <div className="py-8 text-center text-[12px] text-[var(--color-text-muted)]">
          {t("extensions.noReviews")}
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
          {reviews.data.map((review: ReviewItem) => (
            <div key={review.id} className="space-y-2 py-3">
              <div className="flex items-center gap-2">
                <AccountAvatar
                  name={review.userName}
                  picture={review.userAvatar ?? null}
                  size={18}
                />
                <span className="text-[12px] font-medium text-[var(--color-text-highlight)]">
                  {review.userName}
                </span>
                <span className="text-[11px] text-[var(--StatusWarning)]">{review.rating}/5</span>
              </div>
              <p className="text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
                {review.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
