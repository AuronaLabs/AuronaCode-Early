import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LspClient } from "../../../Core/Language/LspClient";
import { EventBus } from "../../../Foundation/EventBus";
import { useLocale } from "../../../Foundation/I18n";
import {
  type InstalledRuntimeSummary,
  type InstalledToolchainSummary,
  LanguageServerIPC,
  type ToolchainsOverview,
} from "../../../Foundation/IPC/LanguageServerCommands";
import { useExtensionStore } from "../../../State/useExtensionStore";
import { useInstallProgressStore } from "../../../State/useInstallProgressStore";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";
import { Button } from "../../../UI/Components/Button";
import { Card } from "../../../UI/Components/Card";
import { EmptyState } from "../../../UI/Components/EmptyState";
import { FilterChips } from "../../../UI/Components/FilterChips";
import { Input } from "../../../UI/Components/Input";
import { showToast } from "../../../UI/Feedback/Toast";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../../UI/Layouts/SidebarPage";
import { canonicalExtensionId } from "../ExtensionId";
import { DependencyConfirmModal, type DependencyInfo } from "./DependencyConfirmModal";
import { MarketplaceCard } from "./MarketplaceCard";
import {
  descriptorToMarketplaceItem,
  type MarketplaceExtensionItem,
  MarketplaceService,
  type MarketplaceSourceStatus,
} from "./MarketplaceService";
import {
  createMarketplaceViewState,
  type MarketplaceMode,
  type MarketplaceModeState,
  MarketplaceRequestCoordinator,
  type MarketplaceViewState,
  updateMarketplaceModeState,
} from "./MarketplaceState";

export type { MarketplaceMode, MarketplaceViewState } from "./MarketplaceState";

function categoryOptions(
  t: (
    key:
      | "extensions.allCategories"
      | "extensions.categoryTrending"
      | "extensions.badgeLsp"
      | "extensions.categoryRuntime"
      | "extensions.categoryProductivity"
      | "extensions.categoryDevTools"
      | "extensions.categoryFormatters"
      | "extensions.categoryThemes",
  ) => string,
): { value: string; label: string }[] {
  return [
    { value: "All", label: t("extensions.allCategories") },
    { value: "trending", label: t("extensions.categoryTrending") },
    { value: "LSP", label: t("extensions.badgeLsp") },
    { value: "Runtime", label: t("extensions.categoryRuntime") },
    { value: "Productivity", label: t("extensions.categoryProductivity") },
    { value: "Developer Tools", label: t("extensions.categoryDevTools") },
    { value: "Formatters", label: t("extensions.categoryFormatters") },
    { value: "Themes", label: t("extensions.categoryThemes") },
  ];
}

function matchesQuery(item: MarketplaceExtensionItem, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [
    item.id,
    item.name,
    item.description,
    ...Object.values(item.displayName),
    ...Object.values(item.displayDescription),
    ...item.tags,
    ...(item.lspMetadata?.languages ?? []),
  ].some((value) => value.toLocaleLowerCase().includes(q));
}

export function localServerItem(
  server: InstalledToolchainSummary,
  runtimes: InstalledRuntimeSummary[],
): MarketplaceExtensionItem {
  const id = canonicalExtensionId(server.id);
  const runtime = runtimes.find((item) => item.runtimeType === server.runtimeType);
  return {
    id,
    kind: "lsp",
    name: server.name,
    displayName: { "zh-CN": server.name, "zh-Hant": server.name, en: server.name },
    publisher: "Local",
    version: server.version,
    description: "",
    displayDescription: { "zh-CN": "", "zh-Hant": "", en: "" },
    category: "LSP",
    tags: ["local", "lsp", ...server.languages],
    installed: true,
    enabled: true,
    packageType: "aurlsp",
    installedVersion: server.version,
    fileSize: formatBytes(server.diskSizeBytes),
    localToolchain: server,
    lspMetadata: {
      languages: server.languages,
      runtimeType: server.runtimeType,
      entry: server.installPath,
    },
    runtimeMetadata: runtime
      ? {
          runtimeType: runtime.runtimeType,
          runtimeVersion: runtime.version,
          binaryPath: runtime.binaryPath,
          fileSize: formatBytes(runtime.diskSizeBytes),
        }
      : undefined,
  };
}

function matchesRuntimeQuery(runtime: InstalledRuntimeSummary, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [runtime.runtimeType, runtime.version, runtime.binaryPath].some((value) =>
    value.toLocaleLowerCase().includes(normalized),
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function MarketplaceView() {
  const { t, locale } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);
  const refreshExtensions = useExtensionStore((state) => state.refresh);
  const openTab = useWorkbenchStore((state) => state.openTab);
  const { setProgress, clearProgress } = useInstallProgressStore();
  const [mode, setMode] = useState<MarketplaceMode>("discover");
  const [viewState, setViewState] = useState<MarketplaceViewState>(createMarketplaceViewState);
  const currentState = viewState[mode];
  const [catalog, setCatalog] = useState<MarketplaceExtensionItem[]>([]);
  const [toolchains, setToolchains] = useState<ToolchainsOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<MarketplaceSourceStatus>("online");
  const [offlineReason, setOfflineReason] = useState<"server-unreachable" | "invalid-response">();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingInstallItem, setPendingInstallItem] = useState<MarketplaceExtensionItem | null>(
    null,
  );
  const [runtimeDependency, setRuntimeDependency] = useState<DependencyInfo[]>([]);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [clientRevision, setClientRevision] = useState(0);
  const requestCoordinator = useRef(new MarketplaceRequestCoordinator());
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevSourceStatusRef = useRef<MarketplaceSourceStatus>("online");
  const lspClient = useMemo(() => LspClient.getInstance(), []);

  const updateCurrentState = useCallback(
    (patch: Partial<MarketplaceModeState>) => {
      setViewState((state) => updateMarketplaceModeState(state, mode, patch));
    },
    [mode],
  );

  const loadToolchains = useCallback(async () => {
    try {
      const next = await LanguageServerIPC.listToolchains();
      setToolchains(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  const refreshCatalog = useCallback(async () => {
    const request = requestCoordinator.current.begin();
    const { controller } = request;
    setIsLoading(true);

    if (mode === "installed") {
      try {
        await refreshExtensions();
      } finally {
        if (requestCoordinator.current.isCurrent(request)) setIsLoading(false);
      }
      return;
    }

    // Toolchains are a local management surface. Search and filter changes
    // refresh IPC state only; the remote catalog is loaded by Discover.
    if (mode === "toolchains") {
      try {
        await loadToolchains();
        if (requestCoordinator.current.isCurrent(request)) {
          setSourceStatus("online");
          setOfflineReason(undefined);
        }
      } finally {
        if (requestCoordinator.current.isCurrent(request)) setIsLoading(false);
      }
      return;
    }

    const query = currentState.committedQuery.trim() || undefined;
    const filter = currentState.filter;
    const category = filter !== "All" && filter !== "trending" ? filter : undefined;
    try {
      const result = await MarketplaceService.fetchMarketplace(query, category, descriptors, {
        signal: controller.signal,
      });
      if (!requestCoordinator.current.isCurrent(request)) return;
      // 仅在 online → offline 转变时推送一次通知，避免每次刷新刷屏
      if (result.source === "offline" && prevSourceStatusRef.current !== "offline") {
        showToast(t("extensions.offlineNotice"), "warning");
      }
      prevSourceStatusRef.current = result.source;
      setSourceStatus(result.source);
      setOfflineReason(result.offlineReason);
      setCatalog(result.items);
    } catch {
      if (!requestCoordinator.current.isCurrent(request)) return;
      if (prevSourceStatusRef.current !== "offline") {
        showToast(t("extensions.offlineNotice"), "warning");
      }
      prevSourceStatusRef.current = "offline";
      setSourceStatus("offline");
      setOfflineReason("server-unreachable");
    } finally {
      if (requestCoordinator.current.isCurrent(request)) setIsLoading(false);
    }
  }, [
    currentState.committedQuery,
    currentState.filter,
    descriptors,
    loadToolchains,
    mode,
    refreshExtensions,
    t,
  ]);

  useEffect(() => {
    void refreshCatalog();
    return () => requestCoordinator.current.abort();
  }, [refreshCatalog]);

  useEffect(() => {
    const unsubscribe = EventBus.on(
      "marketplace:navigate",
      ({ mode: requestedMode, selectedId }) => {
        const nextMode = requestedMode ?? "toolchains";
        setMode(nextMode);
        if (selectedId) {
          setViewState((state) => updateMarketplaceModeState(state, nextMode, { selectedId }));
        }
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = lspClient.subscribe(() => setClientRevision((value) => value + 1));
    return unsubscribe;
  }, [lspClient]);

  // A mode switch must restore its saved offset even when two modes happen to
  // have the same numeric scrollTop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mode changes the active scroll context.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = currentState.scrollTop;
  }, [currentState.scrollTop, mode]);

  const commitSearch = useCallback(() => {
    updateCurrentState({ committedQuery: currentState.draftQuery });
  }, [currentState.draftQuery, updateCurrentState]);

  const handleOpenDetail = (item: MarketplaceExtensionItem) => {
    updateCurrentState({ selectedId: item.id });
    openTab({
      id: `extension:${canonicalExtensionId(item.id)}`,
      type: "extension",
      title: item.displayName?.[locale] ?? item.name,
      path: canonicalExtensionId(item.id),
    });
  };

  const executeInstall = useCallback(
    async (item: MarketplaceExtensionItem) => {
      if (busyId) return;
      setBusyId(item.id);
      setProgress(item.id, "preparing", 5, t("extensions.installing"));
      try {
        if (item.kind === "runtime") {
          await MarketplaceService.installRuntime(item.id, item.version, (progress, stage) => {
            setProgress(
              item.id,
              stage === "extracting" ? "extracting" : "downloading",
              progress,
              stage,
            );
          });
        } else if (item.kind === "lsp") {
          await MarketplaceService.installLspServer(item.id, item.version, (progress, stage) => {
            setProgress(
              item.id,
              stage === "extracting" ? "extracting" : "downloading",
              progress,
              stage,
            );
          });
        } else {
          await MarketplaceService.installExtension(item.id, item.version);
        }
        setProgress(item.id, "completed", 100, t("extensions.installCompleted"));
        await refreshExtensions();
        await loadToolchains();
        await refreshCatalog();
        window.setTimeout(() => clearProgress(item.id), 1200);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("extensions.installFailed");
        setProgress(item.id, "failed", 0, message);
        showToast(message, "warning");
        window.setTimeout(() => clearProgress(item.id), 3000);
      } finally {
        setBusyId(null);
      }
    },
    [busyId, clearProgress, loadToolchains, refreshCatalog, refreshExtensions, setProgress, t],
  );

  const handleInstallClick = (item: MarketplaceExtensionItem) => {
    if (item.kind === "lsp") {
      const requiredRuntime = item.lspMetadata?.runtimeType;
      const runtimeReady = requiredRuntime
        ? toolchains?.runtimes.some((runtime) => runtime.runtimeType === requiredRuntime)
        : true;
      if (requiredRuntime && !runtimeReady) {
        setPendingInstallItem(item);
        setRuntimeDependency([]);
        void loadRuntimeDependency(requiredRuntime);
        setConfirmModalOpen(true);
        return;
      }
    }
    void executeInstall(item);
  };

  const handleUninstall = useCallback(
    async (item: MarketplaceExtensionItem) => {
      if (busyId) return;
      setBusyId(item.id);
      try {
        if (item.kind === "runtime") {
          const runtimeType = item.runtimeMetadata?.runtimeType ?? item.id;
          await MarketplaceService.uninstallSharedRuntime(runtimeType);
        } else if (item.kind === "lsp") {
          await MarketplaceService.uninstallLspServer(item.id);
        } else {
          await MarketplaceService.uninstallExtension(item.id);
        }
        await refreshExtensions();
        await loadToolchains();
        await refreshCatalog();
        showToast(t("extensions.uninstallCompleted"), "info");
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : t("extensions.uninstallFailed"),
          "warning",
        );
      } finally {
        setBusyId(null);
      }
    },
    [busyId, loadToolchains, refreshCatalog, refreshExtensions, t],
  );

  const handleToolchainAction = useCallback(
    async (server: InstalledToolchainSummary, action: "start" | "stop" | "restart") => {
      const language = server.languages[0] || server.id;
      if (busyId) return;
      setBusyId(server.id);
      try {
        if (action === "start") await lspClient.startServer(language);
        else if (action === "stop") await lspClient.stopServer(language);
        else await lspClient.restartServer(language);
        await loadToolchains();
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : t("extensions.toolchainActionFailed"),
          "warning",
        );
      } finally {
        setBusyId(null);
      }
    },
    [busyId, loadToolchains, lspClient, t],
  );

  const visibleExtensions = useMemo(() => {
    const query = currentState.draftQuery;
    if (mode === "installed") {
      return descriptors
        .map(descriptorToMarketplaceItem)
        .filter((item) => matchesQuery(item, query))
        .filter(
          (item) =>
            currentState.filter === "All" ||
            item.category.toLowerCase() === currentState.filter.toLowerCase(),
        );
    }
    if (mode === "discover") {
      let items = catalog.filter((item) => item.kind !== "lsp" && item.kind !== "runtime");
      if (currentState.filter === "trending")
        items = [...items].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
      return items.filter((item) => matchesQuery(item, query));
    }
    return catalog
      .filter((item) => item.kind === "lsp" || item.kind === "runtime")
      .filter(
        (item) =>
          currentState.filter === "All" ||
          item.kind?.toLowerCase() === currentState.filter.toLowerCase(),
      )
      .filter((item) => matchesQuery(item, query));
  }, [catalog, currentState.draftQuery, currentState.filter, descriptors, mode]);

  const localServers = useMemo(() => {
    if (currentState.filter !== "All" && currentState.filter !== "LSP") return [];
    const runtimes = toolchains?.runtimes ?? [];
    return (toolchains?.servers ?? [])
      .map((server) => localServerItem(server, runtimes))
      .filter((item) => matchesQuery(item, currentState.draftQuery));
  }, [currentState.draftQuery, currentState.filter, toolchains?.runtimes, toolchains?.servers]);
  const localRuntimes = useMemo(() => {
    if (currentState.filter !== "All" && currentState.filter !== "Runtime") return [];
    return (toolchains?.runtimes ?? []).filter((runtime) =>
      matchesRuntimeQuery(runtime, currentState.draftQuery),
    );
  }, [currentState.draftQuery, currentState.filter, toolchains?.runtimes]);

  const visibleSelectionIds = useMemo(
    () =>
      [
        ...visibleExtensions.map((item) => item.id),
        ...localServers.map((item) => item.id),
        ...localRuntimes.map((runtime) => runtime.runtimeType),
      ].join("\u0000"),
    [localRuntimes, localServers, visibleExtensions],
  );

  useEffect(() => {
    if (!currentState.selectedId || !visibleSelectionIds) return;
    const selected = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-marketplace-item-id]") ?? [],
    ).find((element) => element.dataset.marketplaceItemId === currentState.selectedId);
    selected?.scrollIntoView?.({ block: "nearest" });
  }, [currentState.selectedId, visibleSelectionIds]);

  const loadRuntimeDependency = useCallback(
    async (runtimeType: string) => {
      const runtime = catalog.find(
        (item) => item.kind === "runtime" && item.runtimeMetadata?.runtimeType === runtimeType,
      );
      const metadata =
        runtime?.runtimeMetadata ?? (await MarketplaceService.fetchRuntimeMetadata(runtimeType));
      if (!metadata) return;
      setRuntimeDependency([
        {
          name: runtime?.name ?? metadata.runtimeType,
          version: metadata.runtimeVersion,
          size: metadata.fileSize,
          type: "runtime",
          description: t("extensions.runtimeDependencyDescription"),
        },
      ]);
    },
    [catalog, t],
  );

  const options = useMemo(() => {
    const all = categoryOptions(t);
    if (mode === "installed")
      return all.filter((option) => option.value === "All" || option.value === "Developer Tools");
    if (mode === "toolchains")
      return all.filter(
        (option) => option.value === "All" || option.value === "LSP" || option.value === "Runtime",
      );
    return all;
  }, [mode, t]);

  return (
    <div className="flex h-full w-full select-none flex-col bg-transparent text-[var(--color-text-primary)]">
      <DependencyConfirmModal
        isOpen={confirmModalOpen}
        targetName={pendingInstallItem?.displayName?.[locale] ?? pendingInstallItem?.name ?? ""}
        targetVersion={pendingInstallItem?.version}
        targetType="lsp"
        dependencies={runtimeDependency}
        permissions={(pendingInstallItem?.permissions ?? []).map((permission) => ({
          name: permission.name,
          description: permission.description,
          level: permission.level,
        }))}
        onConfirm={() => {
          setConfirmModalOpen(false);
          if (pendingInstallItem) void executeInstall(pendingInstallItem);
        }}
        onCancel={() => {
          setConfirmModalOpen(false);
          setPendingInstallItem(null);
          setRuntimeDependency([]);
        }}
      />

      <SidebarPageHeader
        title={t("extensions.marketplaceTitle")}
        actions={
          <Tooltip content={t("extensions.refreshList")} delay={300}>
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              disabled={isLoading}
              className="flex size-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:opacity-50"
              aria-label={t("extensions.refreshList")}
            >
              <Icons.Refresh
                size={15}
                className={isLoading ? "animate-spin text-[var(--color-accent)]" : ""}
              />
            </button>
          </Tooltip>
        }
      />

      <div className="flex flex-col gap-2 px-[var(--PanelPaddingX)] pb-3 pt-1">
        <FilterChips
          size="md"
          ariaLabel={t("extensions.marketplaceTitle")}
          value={mode}
          onChange={setMode}
          items={(["discover", "installed", "toolchains"] as MarketplaceMode[]).map((nextMode) => ({
            id: nextMode,
            label: t(`extensions.${nextMode}`),
          }))}
        />
        <FilterChips
          ariaLabel={t("extensions.category")}
          value={currentState.filter}
          onChange={(value) => updateCurrentState({ filter: value })}
          items={options.map((option) => ({ id: option.value, label: option.label }))}
        />
        <Input
          icon={<Icons.Search size={14} />}
          inputSize="lg"
          fullWidth
          value={currentState.draftQuery}
          onChange={(event) => updateCurrentState({ draftQuery: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitSearch();
            }
          }}
          placeholder={t("extensions.searchPlaceholder")}
        />
      </div>

      {sourceStatus === "offline" && mode === "discover" && (
        <div className="mx-[var(--PanelPaddingX)] mt-2 border-l-2 border-[var(--StatusWarning)] px-3 py-2 text-[11px] text-[var(--StatusWarning)]">
          {t("extensions.offlineNotice")}{" "}
          {offlineReason === "invalid-response"
            ? t("extensions.offlineInvalidResponse")
            : t("extensions.offlineUnavailable")}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(event) => updateCurrentState({ scrollTop: event.currentTarget.scrollTop })}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[var(--PanelPaddingX)] pb-4 pt-3 aurona-scroll"
      >
        {isLoading && visibleExtensions.length === 0 && mode !== "installed" ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-[var(--color-text-muted)]">
            <Icons.Refresh
              size={22}
              className="animate-spin text-[var(--color-accent)] opacity-70"
            />
            <span className="text-[12px] font-medium">{t("extensions.loading")}</span>
          </div>
        ) : mode === "toolchains" ? (
          <ToolchainsPanel
            servers={localServers}
            runtimes={localRuntimes}
            remoteItems={visibleExtensions}
            selectedId={currentState.selectedId}
            client={lspClient}
            revision={clientRevision}
            busyId={busyId}
            onInstall={handleInstallClick}
            onUninstall={handleUninstall}
            onAction={handleToolchainAction}
            onOpenDetail={handleOpenDetail}
          />
        ) : visibleExtensions.length === 0 ? (
          <EmptyMarketplaceState
            isOffline={sourceStatus === "offline"}
            onRefresh={() => void refreshCatalog()}
          />
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {visibleExtensions.map((item) => (
              <MarketplaceCard
                key={item.id}
                item={item}
                selected={currentState.selectedId === item.id}
                onOpenDetail={handleOpenDetail}
                onInstall={handleInstallClick}
                onUninstall={handleUninstall}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyMarketplaceState({
  isOffline,
  onRefresh,
}: {
  isOffline: boolean;
  onRefresh: () => void;
}) {
  const { t } = useLocale();
  return (
    <EmptyState
      className="h-48 flex-none"
      icon={<Icons.Extensions size={27} stroke={1.45} />}
      title={t("extensions.emptyList")}
      description={t("extensions.emptyListHint")}
      actions={
        isOffline ? (
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            <Icons.Refresh size={11} />
            {t("extensions.refreshList")}
          </Button>
        ) : undefined
      }
    />
  );
}

interface ToolchainsPanelProps {
  servers: MarketplaceExtensionItem[];
  runtimes: InstalledRuntimeSummary[];
  remoteItems: MarketplaceExtensionItem[];
  selectedId: string | null;
  client: LspClient;
  revision: number;
  busyId: string | null;
  onInstall: (item: MarketplaceExtensionItem) => void;
  onUninstall: (item: MarketplaceExtensionItem) => void;
  onAction: (server: InstalledToolchainSummary, action: "start" | "stop" | "restart") => void;
  onOpenDetail: (item: MarketplaceExtensionItem) => void;
}

function ToolchainsPanel({
  servers,
  runtimes,
  remoteItems,
  selectedId,
  client,
  revision: _revision,
  busyId,
  onInstall,
  onUninstall,
  onAction,
  onOpenDetail,
}: ToolchainsPanelProps) {
  const { t } = useLocale();
  const installedIds = new Set(servers.map((server) => server.id));
  const installedRuntimeTypes = new Set(runtimes.map((runtime) => runtime.runtimeType));
  const remoteAvailable = remoteItems.filter((item) => {
    if (item.kind === "lsp") {
      return !installedIds.has(canonicalExtensionId(item.id)) || item.updateAvailable;
    }
    if (item.kind === "runtime") {
      const runtimeType = item.runtimeMetadata?.runtimeType ?? item.id;
      return !installedRuntimeTypes.has(runtimeType) || item.updateAvailable;
    }
    return false;
  });
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {t("extensions.toolchainsServers")}
        </h3>
        {servers.length === 0 ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {t("extensions.noInstalledToolchains")}
          </p>
        ) : (
          servers.map((item) => (
            <InstalledServerRow
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              client={client}
              busyId={busyId}
              onUninstall={onUninstall}
              onAction={onAction}
            />
          ))
        )}
      </section>
      {remoteAvailable.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t("extensions.availableToolchains")}
          </h3>
          {remoteAvailable.map((item) => (
            <MarketplaceCard
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              onOpenDetail={onOpenDetail}
              onInstall={onInstall}
              onUninstall={onUninstall}
            />
          ))}
        </section>
      )}
      <section className="flex flex-col gap-2.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {t("extensions.toolchainsRuntimes")}
        </h3>
        {runtimes.length === 0 ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {t("extensions.noInstalledRuntimes")}
          </p>
        ) : (
          runtimes.map((runtime) => (
            <RuntimeRow
              key={runtime.runtimeType}
              runtime={runtime}
              selected={selectedId === runtime.runtimeType}
              busy={busyId === runtime.runtimeType}
              onUninstall={() =>
                onUninstall({
                  id: runtime.runtimeType,
                  kind: "runtime",
                  name: runtime.runtimeType,
                  displayName: { en: runtime.runtimeType },
                  publisher: "Local",
                  version: runtime.version,
                  description: "",
                  displayDescription: { en: "" },
                  category: "Runtime",
                  tags: [],
                  installed: true,
                  packageType: "aurx",
                })
              }
            />
          ))
        )}
      </section>
    </div>
  );
}

function InstalledServerRow({
  item,
  selected,
  client,
  busyId,
  onUninstall,
  onAction,
}: {
  item: MarketplaceExtensionItem;
  selected: boolean;
  client: LspClient;
  busyId: string | null;
  onUninstall: (item: MarketplaceExtensionItem) => void;
  onAction: (server: InstalledToolchainSummary, action: "start" | "stop" | "restart") => void;
}) {
  const { t } = useLocale();
  const language = item.lspMetadata?.languages?.[0] ?? item.id;
  const state = client.getState(language);
  const server = item.localToolchain;
  return (
    <Card
      data-marketplace-item-id={item.id}
      data-selected={selected || undefined}
      className={`flex flex-col gap-2.5 p-3.5 transition-colors duration-150 hover:bg-[var(--material-interactive-hover)] ${
        selected ? "border-[var(--color-accent)]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-[var(--color-text-highlight)]">
              {item.name}
            </span>
            <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
              v{item.version}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            {item.lspMetadata?.languages?.join(", ")} · {item.lspMetadata?.runtimeType} ·{" "}
            {item.fileSize} · {item.lspMetadata?.entry}
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
          {state?.status ?? t("extensions.stopped")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {server &&
          (state?.status === "running" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busyId === item.id}
              onClick={() => onAction(server, "stop")}
            >
              {t("extensions.stop")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={busyId === item.id}
              onClick={() => onAction(server, "start")}
            >
              {t("extensions.start")}
            </Button>
          ))}
        {server && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busyId === item.id}
            onClick={() => onAction(server, "restart")}
          >
            {t("extensions.restart")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-[var(--StatusError)]"
          disabled={busyId === item.id}
          onClick={() => onUninstall(item)}
        >
          {t("extensions.uninstall")}
        </Button>
      </div>
    </Card>
  );
}

function RuntimeRow({
  runtime,
  selected,
  busy,
  onUninstall,
}: {
  runtime: InstalledRuntimeSummary;
  selected: boolean;
  busy: boolean;
  onUninstall: () => void;
}) {
  const { t } = useLocale();
  return (
    <Card
      data-marketplace-item-id={runtime.runtimeType}
      data-selected={selected || undefined}
      className={`flex items-center justify-between gap-3 p-3.5 transition-colors duration-150 hover:bg-[var(--material-interactive-hover)] ${
        selected ? "border-[var(--color-accent)]" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[var(--color-text-highlight)]">
          {runtime.runtimeType}
        </div>
        <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
          v{runtime.version} · {formatBytes(runtime.diskSizeBytes)} · {runtime.binaryPath}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 text-[var(--StatusError)]"
        disabled={busy}
        onClick={onUninstall}
      >
        {t("extensions.uninstall")}
      </Button>
    </Card>
  );
}
