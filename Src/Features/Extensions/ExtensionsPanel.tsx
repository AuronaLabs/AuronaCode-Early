import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveExtensionDescription,
  resolveExtensionName,
} from "../../Core/Extensions/ExtensionRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { ExtensionIPC } from "../../Foundation/IPC/ExtensionCommands";
import {
  LanguageServerIPC,
  type ToolchainsOverview,
} from "../../Foundation/IPC/LanguageServerCommands";
import { NetworkIPC } from "../../Foundation/IPC/NetworkCommands";
import { useExtensionStore } from "../../State/useExtensionStore";
import { useWorkbenchStore } from "../../State/Workbench/useWorkbenchStore";
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { Modal } from "../../UI/Components/Modal";
import { Switch } from "../../UI/Components/Switch";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";

export function ExtensionsPanel() {
  const { t, locale } = useLocale();
  const descriptors = useExtensionStore((state) => state.descriptors);
  const hiddenIds = useExtensionStore((state) => state.hiddenExtensionIds);
  const refresh = useExtensionStore((state) => state.refresh);
  const hide = useExtensionStore((state) => state.hideExtension);
  const restore = useExtensionStore((state) => state.restoreExtension);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{
    id: string;
    name: string;
    kind: "extension" | "server" | "runtime";
  } | null>(null);
  const [toolchains, setToolchains] = useState<ToolchainsOverview | null>(null);
  const running = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadToolchains = useCallback(async () => {
    const overview = await LanguageServerIPC.listToolchains();
    if (alive.current) setToolchains(overview);
  }, []);

  useEffect(() => {
    void loadToolchains().catch((error) => showToast(String(error), "error"));
    return EventBus.on("toolchains:changed", () => {
      void loadToolchains().catch((error) => showToast(String(error), "error"));
    });
  }, [loadToolchains]);

  const run = async (work: () => Promise<boolean | undefined>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const changed = await work();
      if (changed !== false) {
        await refresh();
        if (alive.current) showToast(t("extensions.manager.completed"), "success");
      }
    } catch (error) {
      if (alive.current) showToast(String(error), "error");
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const importPackage = (kind: "extension" | "vscode" | "toolchain") =>
    run(async () => {
      const artifact = await NetworkIPC.pickArtifact(kind);
      if (!artifact) return false;
      if (kind === "toolchain") {
        await LanguageServerIPC.installToolchain(artifact.artifactId);
        EventBus.emit("toolchains:changed");
      } else if (kind === "vscode") {
        await ExtensionIPC.installVscode(artifact.artifactId);
      } else {
        await ExtensionIPC.install(artifact.artifactId);
      }
    });

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return descriptors.filter((extension) =>
      [resolveExtensionName(extension, locale), extension.id, extension.publisher].some((text) =>
        text.toLocaleLowerCase().includes(needle),
      ),
    );
  }, [descriptors, locale, query]);

  const openPermissions = () => {
    useWorkbenchStore.getState().openTab({
      id: "settings",
      type: "settings",
      title: t("settings.title"),
      titleKey: "settings.title",
    });
    EventBus.emit("settings:nav", "extensions");
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("extensions.manager.title")}>
      <SidebarPageHeader
        title={t("extensions.manager.title")}
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={t("extensions.manager.refresh")}
            onClick={() =>
              void run(async () => {
                await loadToolchains();
                return true;
              })
            }
          >
            <Icons.Refresh size={15} />
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[var(--PanelPaddingX)] pb-5">
        <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
          {t("extensions.manager.description")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void importPackage("extension")}>
            {t("extensions.manager.importAurx")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void importPackage("vscode")}
          >
            {t("extensions.manager.importVsix")}
          </Button>
        </div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          fullWidth
          placeholder={t("extensions.manager.search")}
          aria-label={t("extensions.manager.search")}
        />
        <div className="flex items-center justify-between text-[12px] text-[var(--color-text-muted)]">
          <span>
            {t("extensions.manager.installed")} · {descriptors.length}
          </span>
          <button
            type="button"
            className="text-[var(--color-accent)] hover:underline"
            onClick={openPermissions}
          >
            {t("extensions.manager.permissions")}
          </button>
        </div>
        {visible.length === 0 && (
          <p className="py-8 text-center text-[12px] text-[var(--color-text-muted)]">
            {t(descriptors.length ? "extensions.manager.noMatches" : "extensions.manager.empty")}
          </p>
        )}
        <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
          {visible.map((extension) => {
            const name = resolveExtensionName(extension, locale);
            return (
              <li key={extension.id} className="flex flex-col gap-2 py-4 first:pt-0">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <h3 className="truncate text-[13px] font-semibold text-[var(--color-text-highlight)]">
                    {name}
                  </h3>
                  <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
                    {extension.version}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)]">{extension.publisher}</p>
                <p className="line-clamp-3 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
                  {resolveExtensionDescription(extension, locale)}
                </p>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <label
                    htmlFor={`extension-visible-${extension.id}`}
                    className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]"
                  >
                    <Switch
                      id={`extension-visible-${extension.id}`}
                      checked={!hiddenIds.includes(extension.id)}
                      disabled={busy}
                      aria-label={`${t("extensions.manager.showInSidebar")} ${name}`}
                      onCheckedChange={(checked) =>
                        checked ? restore(extension.id) : hide(extension.id)
                      }
                    />
                    {t("extensions.manager.showInSidebar")}
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRemoving({ id: extension.id, name, kind: "extension" })}
                  >
                    {t("extensions.manager.uninstall")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <details className="border-t border-[var(--border-subtle)] pt-3">
          <summary className="cursor-pointer text-[12px] font-medium text-[var(--color-text-secondary)]">
            {t("extensions.manager.toolchains")}
          </summary>
          <div className="flex flex-col gap-3 pt-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void importPackage("toolchain")}
            >
              {t("extensions.manager.importToolchain")}
            </Button>
            {toolchains?.servers.map((server) => (
              <div key={server.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate text-[var(--color-text-secondary)]">
                  {server.name}{" "}
                  <span className="text-[var(--color-text-muted)]">{server.version}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRemoving({ id: server.id, name: server.name, kind: "server" })}
                >
                  {t("extensions.manager.uninstall")}
                </Button>
              </div>
            ))}
            {toolchains?.runtimes.map((runtime) => (
              <div
                key={runtime.runtimeType}
                className="flex items-center justify-between gap-2 text-[12px]"
              >
                <span className="text-[var(--color-text-muted)]">
                  {runtime.runtimeType} · {runtime.version}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setRemoving({
                      id: runtime.runtimeType,
                      name: runtime.runtimeType,
                      kind: "runtime",
                    })
                  }
                >
                  {t("extensions.manager.uninstall")}
                </Button>
              </div>
            ))}
          </div>
        </details>
      </div>
      <Modal
        isOpen={removing !== null}
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        title={t("extensions.manager.uninstall")}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setRemoving(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!removing) return false;
                  if (removing.kind !== "extension") {
                    if (removing.kind === "runtime")
                      await LanguageServerIPC.uninstallToolchainRuntime(removing.id);
                    else await LanguageServerIPC.uninstallToolchain(removing.id);
                    EventBus.emit("toolchains:changed");
                  } else await ExtensionIPC.uninstall(removing.id);
                  if (alive.current) setRemoving(null);
                })
              }
            >
              {t("extensions.manager.uninstall")}
            </Button>
          </>
        }
      >
        {t("extensions.manager.uninstallConfirm").replace("{name}", removing?.name ?? "")}
      </Modal>
    </section>
  );
}
