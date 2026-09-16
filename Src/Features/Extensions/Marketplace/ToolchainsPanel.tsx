import type { LspClient } from "../../../Core/Language/LspClient";
import { useLocale } from "../../../Foundation/I18n";
import type {
  InstalledRuntimeSummary,
  InstalledToolchainSummary,
} from "../../../Foundation/IPC/LanguageServerCommands";
import { Button } from "../../../UI/Components/Button";
import { Card } from "../../../UI/Components/Card";
import { canonicalExtensionId } from "../ExtensionId";
import { MarketplaceCard } from "./MarketplaceCard";
import type { MarketplaceExtensionItem } from "./MarketplaceService";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
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

/** 工具链标签页：已装 LSP 服务、可装远程包与运行时三段列表（从 MarketplaceView 拆出）。 */
export function ToolchainsPanel({
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
