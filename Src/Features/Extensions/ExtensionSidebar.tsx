import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentService } from "../../Core/DocumentService";
import { useLocale } from "../../Foundation/I18n";
import {
  ExtensionIPC,
  type ExtensionPermissionState,
  type ExtensionViewPayload,
} from "../../Foundation/IPC/ExtensionCommands";
import { SIDEBAR_EXTENSIONS } from "../../Shared/Constants/Sidebar";
import { useExtensionStore } from "../../State/useExtensionStore";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { resolveExtensionName } from "./ExtensionUtils";
import { type ExtensionRenderState, ExtensionViewHost } from "./ExtensionViewHost";

const LARGE_DOCUMENT_BYTES = 512 * 1024;
const RENDER_DEBOUNCE_MS = 80;
const LARGE_DOCUMENT_DEBOUNCE_MS = 350;

function currentTheme(): string {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const isMarkdownFile = (filePath: string | null): boolean => {
  if (!filePath) return false;
  return /\.(md|markdown|mdown|mkd|mdx)$/i.test(filePath);
};

export function ExtensionSidebar({ extensionId }: { extensionId: string }) {
  const { t, locale } = useLocale();
  const descriptor = useExtensionStore((state) =>
    state.descriptors.find((item) => item.id === extensionId),
  );
  const tabs = useWorkbenchStore((state) => state.tabs);
  const activeTabId = useWorkbenchStore((state) => state.activeTabId);
  const setActiveSidebar = useWorkbenchStore((state) => state.setActiveSidebar);
  const activePath =
    tabs.find((tab) => tab.id === activeTabId && tab.type === "file")?.path ?? null;

  const [view, setView] = useState<ExtensionViewPayload | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const [editorPermission, setEditorPermission] = useState<ExtensionPermissionState>("unknown");
  const [renderState, setRenderState] = useState<ExtensionRenderState | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const latestDocument = useRef<{ content: string; version: number } | null>(null);
  const debounceTimer = useRef<number | null>(null);
  const generation = useRef(0);
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  const runRender = useCallback(
    async (docPayload: { content: string; version: number }) => {
      const currentGeneration = ++generation.current;
      try {
        const isBold = window.document.documentElement.getAttribute("data-bold-text") === "true";
        const fontSizeAttr =
          window.document.documentElement.getAttribute("data-font-size") || "default";
        const accentTheme =
          window.document.documentElement.getAttribute("data-accent-theme") || "aurora";
        const response = await ExtensionIPC.render({
          extensionId,
          markdown: docPayload.content,
          activeEditorPath: activePathRef.current,
          theme: currentTheme(),
          accentColor: accentTheme,
          colorScheme: currentTheme(),
          locale,
          fontWeight: isBold ? "bold" : "normal",
          fontSize: fontSizeAttr,
        });
        if (currentGeneration !== generation.current) return;
        setRenderError(null);
        setRenderState({
          html: response.html,
          diagnostics: response.diagnostics,
          revision: docPayload.version,
        });
      } catch (error) {
        if (currentGeneration !== generation.current) return;
        setRenderError(error instanceof Error ? error.message : String(error));
      }
    },
    [extensionId, locale],
  );

  const scheduleRender = useCallback(() => {
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
    const document = latestDocument.current;
    if (!document) return;
    const delay =
      document.content.length > LARGE_DOCUMENT_BYTES
        ? LARGE_DOCUMENT_DEBOUNCE_MS
        : RENDER_DEBOUNCE_MS;
    debounceTimer.current = window.setTimeout(() => {
      void runRender(document);
    }, delay);
  }, [runRender]);

  const refresh = useCallback(async () => {
    const path = activePathRef.current;
    if (!path || !isMarkdownFile(path)) {
      latestDocument.current = null;
      setRenderState(null);
      setRenderError(null);
      return;
    }
    let record = DocumentService.get(path);
    if (!record || record.content === undefined) {
      try {
        record = await DocumentService.open(path);
      } catch {
        // ignore
      }
    }
    if (record?.content !== undefined) {
      latestDocument.current = { content: record.content, version: record.version };
      await runRender(latestDocument.current);
    }
  }, [runRender]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await useExtensionStore.getState().viewFor(extensionId);
        if (!cancelled) setView(loaded ?? null);
      } catch {
        if (!cancelled) setViewFailed(true);
      }
    })();
    void (async () => {
      try {
        const editorState = await useExtensionStore
          .getState()
          .permissionFor(extensionId, "editor.current.read");
        if (!cancelled) {
          setEditorPermission(editorState);
          if (editorState === "granted") {
            void refresh();
          }
        }
      } catch {
        // 权限查询失败时保持未知状态
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [extensionId, refresh]);

  useEffect(() => {
    if (debounceTimer.current !== null) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (!activePath) {
      latestDocument.current = null;
      setRenderState(null);
      setRenderError(null);
      return;
    }
    void refresh();
    const unsubscribe = DocumentService.subscribe(activePath, (record) => {
      if (!record || record.content === undefined) {
        latestDocument.current = null;
        setRenderState(null);
        return;
      }
      const prev = latestDocument.current;
      latestDocument.current = { content: record.content, version: record.version };
      if (editorPermission === "granted") {
        if (!prev || prev.version === 0) {
          void runRender(latestDocument.current);
        } else {
          scheduleRender();
        }
      }
    });
    return unsubscribe;
  }, [activePath, editorPermission, refresh, runRender, scheduleRender]);

  useEffect(
    () => () => {
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (renderError) {
      showToast(`${t("extensions.renderError")}: ${renderError}`, "error");
    }
  }, [renderError, t]);

  const name = resolveExtensionName(descriptor, locale) || extensionId;
  const isPermissionGranted = editorPermission === "granted";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* 顶部标题栏：由 Aurona Code 宿主获取名称，不显示版本号，提供刷新按钮 */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-3.5 pb-1.5 pt-2">
        <h2 className="truncate text-[13px] font-semibold text-[var(--color-text-highlight)]">
          {name}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 rounded-md p-0 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-highlight)]"
          title="刷新预览"
          onClick={() => void refresh()}
        >
          <Icons.Refresh size={14} stroke={1.75} />
        </Button>
      </div>

      {/* 核心内卡片容器：带边距与圆角矩形，内部由插件完全掌控设计 */}
      <div className="relative mx-2.5 mb-2.5 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/30 shadow-[inset_0_1px_1px_var(--material-inset)]">
        {!isPermissionGranted ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--material-surface)] text-[var(--color-text-muted)]">
              <Icons.InfoCircle size={22} stroke={1.5} />
            </div>
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {t("extensions.permissionTitle")}
            </span>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {t("extensions.editorReadDescription")}
            </p>
            <Button size="sm" className="mt-2" onClick={() => setActiveSidebar(SIDEBAR_EXTENSIONS)}>
              {t("extensions.sidebarTitle")}
            </Button>
          </div>
        ) : viewFailed ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-[var(--color-text-muted)]">
            {t("extensions.viewFailed")}
          </div>
        ) : !activePath ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--material-surface)] text-[var(--color-text-muted)]">
              <Icons.FileText size={20} stroke={1.5} />
            </div>
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {t("extensions.noActiveEditor")}
            </span>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {t("extensions.markdownOnlyPrompt")}
            </p>
          </div>
        ) : !isMarkdownFile(activePath) ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--material-surface)] text-[var(--color-text-muted)]">
              <Icons.FileText size={20} stroke={1.5} />
            </div>
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {t("extensions.nonMarkdownFile")}
            </span>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {t("extensions.markdownOnlyPrompt")}
            </p>
          </div>
        ) : view ? (
          <ExtensionViewHost
            viewHtml={view.html}
            theme={currentTheme()}
            renderState={renderState}
          />
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-[var(--color-text-muted)]">
            {t("extensions.loading")}
          </div>
        )}
      </div>
    </div>
  );
}
