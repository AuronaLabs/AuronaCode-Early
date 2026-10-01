import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentService } from "../../Core/DocumentService";
import { loadEditorViewState, saveEditorViewState } from "../../Core/Editor/EditorViewStateStore";
import { EditorSaveRegistry } from "../../Core/EditorSaveRegistry";
import { FileSystemService } from "../../Core/FileSystemService";
import { RecoveryCoordinator } from "../../Core/Recovery/RecoveryCoordinator";
import { RecoveryStore } from "../../Core/Recovery/RecoveryStore";
import { DesktopError } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { EditorViewState } from "../../Foundation/Types/Editor";
import { isBinaryExtension } from "../../Shared/Constants/FileTypes";
import { GetLanguageFromPath } from "../../Shared/Utils/LanguageUtils";
import { showNotification, showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { AuronaEngine } from "./AuronaEngine";
import { EditorBreadcrumb } from "./components/EditorBreadcrumb";
import { EditorCapsule, type EditorViewMode } from "./components/EditorCapsule";
import { MarkdownPreview } from "./components/MarkdownPreview";

type EditorTabProps = {
  path: string;
  isActive: boolean;
  revealLine?: number;
  onRevealHandled?: (path: string, line: number) => void;
};

const getExtension = (filePath: string) => {
  const index = filePath.lastIndexOf(".");
  return index >= 0 ? filePath.slice(index + 1).toLowerCase() : "";
};

const getFileName = (filePath: string) => filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;

export const EditorTab: React.FC<EditorTabProps> = React.memo(function EditorTab({
  path,
  isActive,
  revealLine,
  onRevealHandled,
}) {
  const { t } = useLocale();
  const [fileContent, setFileContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isBinaryWarning, setIsBinaryWarning] = useState(false);
  const [syncError, setSyncError] = useState<Error | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [diskFingerprint, setDiskFingerprint] = useState("");
  const persistedViewState = useMemo(() => loadEditorViewState(path), [path]);
  const [viewState, setViewState] = useState<{ path: string; mode: EditorViewMode }>({
    path,
    mode: persistedViewState?.mode === "preview" ? "preview" : "source",
  });
  const [focusRequest, setFocusRequest] = useState(0);
  const [capsuleEnabled, setCapsuleEnabled] = useState(false);
  const previewScrollTop = useRef(persistedViewState?.previewScrollTop ?? 0);
  const [externalContent, setExternalContent] = useState<{
    content: string;
    nonce: number;
  } | null>(null);
  const [loadError, setLoadError] = useState<{ code?: string; message: string } | null>(null);
  const loadedPathRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const contentRef = useRef("");
  const savedContentRef = useRef("");
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const pendingViewStateRef = useRef<EditorViewState | null>(null);
  const viewStateTimerRef = useRef<number | null>(null);

  const isDirty = fileContent !== savedContent;
  const isMarkdown = ["md", "markdown"].includes(getExtension(path));
  const viewMode = viewState.path === path ? viewState.mode : "source";

  const flushViewState = useCallback(() => {
    if (viewStateTimerRef.current !== null) {
      window.clearTimeout(viewStateTimerRef.current);
      viewStateTimerRef.current = null;
    }
    const pending = pendingViewStateRef.current;
    if (!pending) return;
    pendingViewStateRef.current = null;
    saveEditorViewState(pending.path ?? path, pending);
  }, [path]);

  const scheduleViewStateSave = useCallback(
    (state: EditorViewState) => {
      pendingViewStateRef.current = state;
      if (viewStateTimerRef.current !== null) window.clearTimeout(viewStateTimerRef.current);
      viewStateTimerRef.current = window.setTimeout(() => {
        viewStateTimerRef.current = null;
        const pending = pendingViewStateRef.current;
        if (!pending) return;
        pendingViewStateRef.current = null;
        saveEditorViewState(pending.path ?? path, pending);
      }, 120);
    },
    [path],
  );

  useEffect(() => () => flushViewState(), [flushViewState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleViewStateChange = useCallback(
    (state: EditorViewState) => {
      scheduleViewStateSave({
        ...state,
        mode: viewMode,
        previewScrollTop: previewScrollTop.current,
      });
    },
    [scheduleViewStateSave, viewMode],
  );

  const changeViewMode = useCallback(
    (mode: EditorViewMode) => {
      if (mode === viewMode) return;
      setViewState({ path, mode });
      const base = pendingViewStateRef.current ??
        loadEditorViewState(path) ?? {
          path,
          line: 1,
          column: 1,
          scrollTop: 0,
          scrollLeft: 0,
        };
      scheduleViewStateSave({
        ...base,
        path,
        mode,
        previewScrollTop: previewScrollTop.current,
      });
      if (mode === "source") setFocusRequest((request) => request + 1);
    },
    [path, scheduleViewStateSave, viewMode],
  );

  useEffect(() => {
    let mounted = true;
    const refreshCapsuleSetting = () => {
      void UserConfigStore.get().then((config) => {
        if (!mounted) return;
        const enabled = config.editorCapsuleEnabled ?? true;
        setCapsuleEnabled(enabled);
        if (!enabled) {
          setViewState({ path, mode: "source" });
          const base = pendingViewStateRef.current ??
            loadEditorViewState(path) ?? {
              path,
              line: 1,
              column: 1,
              scrollTop: 0,
              scrollLeft: 0,
            };
          scheduleViewStateSave({
            ...base,
            path,
            mode: "source",
            previewScrollTop: previewScrollTop.current,
          });
        }
      });
    };
    refreshCapsuleSetting();
    const unsubscribe = EventBus.on("settings:editor-changed", refreshCapsuleSetting);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [path, scheduleViewStateSave]);

  const loadContent = useCallback(
    async (filePath: string, force = false) => {
      const generation = ++loadGenerationRef.current;
      const isCurrentLoad = () =>
        mountedRef.current &&
        generation === loadGenerationRef.current &&
        loadedPathRef.current === filePath;
      try {
        const ext = getExtension(filePath);
        if (!force && isBinaryExtension(ext)) {
          if (!isCurrentLoad()) return;
          setLoadError(null);
          setIsBinaryWarning(true);
          setFileContent("");
          setSavedContent("");
          EventBus.emit("editor:dirty-cleared", { path: filePath });
          return;
        }

        setIsBinaryWarning(false);
        setLoadError(null);
        setSyncError(null);
        DocumentService.clearSyncError(filePath);
        setIsEditorReady(false);
        const document = await DocumentService.open(filePath);
        if (!isCurrentLoad()) return;
        const content = document.content;
        const recovery = await RecoveryStore.load(filePath);
        if (!isCurrentLoad()) return;
        if (recovery && recovery.text !== content) {
          const fileName = filePath.split(/[\\/]/).pop() || filePath;
          showNotification({
            id: `recovery-${filePath}`,
            type: "confirm",
            title: t("editor.recoverySnapshotTitle"),
            message: t("editor.recoverySnapshotMessage").replace("{file}", fileName),
            duration: null,
            actions: [
              {
                label: t("editor.restoreAction"),
                primary: true,
                onClick: async () => {
                  try {
                    if (!isCurrentLoad()) return;
                    await DocumentService.applyEdit(
                      filePath,
                      0,
                      contentRef.current.length,
                      recovery.text,
                      recovery.text,
                    );
                    if (!isCurrentLoad()) return;
                    contentRef.current = recovery.text;
                    setFileContent(recovery.text);
                    showToast(t("editor.recoveryRestored"), "success");
                  } catch (err) {
                    setSyncError(err instanceof Error ? err : new Error(String(err)));
                  }
                },
              },
              {
                label: t("editor.ignoreAction"),
                variant: "secondary",
                onClick: async () => {
                  await RecoveryStore.remove(filePath);
                },
              },
            ],
          });
        }
        setFileContent(content);
        setSavedContent(content);
        setExternalContent(null);
        contentRef.current = content;
        savedContentRef.current = content;
        setIsEditorReady(true);
        EventBus.emit("editor:dirty-cleared", { path: filePath });
      } catch (error) {
        if (!isCurrentLoad()) return;
        const message = FileSystemService.toMessage(error);
        if (!force && /utf-8|invalid data|stream did not contain/i.test(message)) {
          setIsBinaryWarning(true);
          setFileContent("");
          setSavedContent("");
        } else {
          setLoadError({
            code: error instanceof DesktopError ? error.code : undefined,
            message,
          });
          setFileContent("");
          setSavedContent("");
          setIsEditorReady(false);
        }
        EventBus.emit("editor:dirty-cleared", { path: filePath });
      }
    },
    [t],
  );

  // 外部 WorkspaceEdit（Rename / Code Action）应用到文档后，同步打开中的编辑器。
  useEffect(
    () =>
      DocumentService.subscribe(path, (record) => {
        if (record?.changeOrigin !== "external" || record.content === contentRef.current) {
          return;
        }

        // Keep the controlled editor value and its save checkpoint in sync
        // when a rename/code action updates the shared document session.
        contentRef.current = record.content;
        setFileContent(record.content);
        if (!record.isDirty) {
          savedContentRef.current = record.content;
          setSavedContent(record.content);
        }
        setExternalContent({ content: record.content, nonce: Date.now() });
      }),
    [path],
  );

  const saveContent = useCallback(
    async (allowInactive = false): Promise<boolean> => {
      if ((!isActive && !allowInactive) || isBinaryWarning) return false;
      if (saveInFlightRef.current) return saveInFlightRef.current;
      if (contentRef.current === savedContentRef.current) {
        return true;
      }

      const contentCheckpoint = contentRef.current;
      const saving = (async () => {
        try {
          setIsSaving(true);
          const response = await DocumentService.save(path);
          setDiskFingerprint(response.diskFingerprint);
          savedContentRef.current = contentCheckpoint;
          setSavedContent(contentCheckpoint);

          if (contentRef.current === contentCheckpoint) {
            await RecoveryCoordinator.discard(path);
            EventBus.emit("editor:dirty-cleared", { path });
            EventBus.emit("editor:file-saved", { path });
            return true;
          } else {
            RecoveryCoordinator.update(path, contentRef.current, response.diskFingerprint, true);
            await RecoveryCoordinator.flush(path);
            EventBus.emit("editor:dirty-set", { path });
            return false;
          }
        } catch (error) {
          setSyncError(error instanceof Error ? error : new Error(String(error)));
          showToast(`保存失败：${FileSystemService.toMessage(error)}`, "error");
          return false;
        } finally {
          setIsSaving(false);
        }
      })();
      saveInFlightRef.current = saving;
      try {
        return await saving;
      } finally {
        if (saveInFlightRef.current === saving) saveInFlightRef.current = null;
      }
    },
    [isActive, isBinaryWarning, path],
  );

  useEffect(
    () =>
      EditorSaveRegistry.register(path, {
        save: () => saveContent(true),
        isDirty: () => contentRef.current !== savedContentRef.current,
      }),
    [path, saveContent],
  );

  const handleContentChange = useCallback((content: string) => {
    contentRef.current = content;
    setFileContent(content);
  }, []);

  const handleReloadAfterSyncError = useCallback(async () => {
    try {
      RecoveryCoordinator.update(path, contentRef.current, diskFingerprint, true);
      await RecoveryCoordinator.flush(path);
      setIsEditorReady(false);
      await DocumentService.close(path, true);
      DocumentService.clearSyncError(path);
      setSyncError(null);
      await loadContent(path, true);
      setEditorKey((key) => key + 1);
      showToast(t("editor.reloadedFromDisk"), "success");
    } catch (error) {
      showToast(
        t("editor.reloadFailed").replace("{message}", FileSystemService.toMessage(error)),
        "error",
      );
      setIsEditorReady(true);
    }
  }, [diskFingerprint, loadContent, path, t]);

  const handleCopyLocalContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(contentRef.current);
      showToast(t("editor.copiedLocalContent"), "info");
    } catch (error) {
      showToast(
        t("editor.copyFailed").replace("{message}", FileSystemService.toMessage(error)),
        "error",
      );
    }
  }, [t]);

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(path);
      showToast(t("editorTabBar.copyPath"), "info");
    } catch {
      // Clipboard access can be unavailable in a locked-down WebView; the capsule remains
      // useful as a source/preview switcher in that case.
    }
  }, [path, t]);

  useEffect(() => {
    if (!syncError) return;
    const notificationId = `sync-error-${path}`;
    showNotification({
      id: notificationId,
      type: "error",
      title: t("editor.syncErrorTitle"),
      message: t("editor.syncErrorMessage"),
      duration: null,
      actions: [
        {
          label: t("editor.copyLocalContentAction"),
          variant: "secondary",
          onClick: () => void handleCopyLocalContent(),
        },
        {
          label: t("editor.reloadFromDiskAction"),
          variant: "danger",
          onClick: () => void handleReloadAfterSyncError(),
        },
      ],
    });
  }, [syncError, path, t, handleCopyLocalContent, handleReloadAfterSyncError]);

  useEffect(() => {
    if (path !== loadedPathRef.current) {
      setIsBinaryWarning(false);
      setIsEditorReady(false);
      loadedPathRef.current = path;
      loadContent(path);
    }
  }, [loadContent, path]);

  useEffect(() => {
    return () => {
      RecoveryCoordinator.unregister(path);
      void DocumentService.close(path, true).catch(console.error);
    };
  }, [path]);

  useEffect(() => {
    contentRef.current = fileContent;
    savedContentRef.current = savedContent;
    const ev = isDirty ? "editor:dirty-set" : "editor:dirty-cleared";
    EventBus.emit(ev, { path });
  }, [fileContent, isDirty, path, savedContent]);

  useEffect(() => {
    RecoveryCoordinator.update(
      path,
      fileContent,
      diskFingerprint,
      isEditorReady && isDirty && !isBinaryWarning,
    );
  }, [diskFingerprint, fileContent, isBinaryWarning, isDirty, isEditorReady, path]);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveContent();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, saveContent]);

  useEffect(() => {
    return EventBus.on("app:save-file", () => {
      void saveContent();
    });
  }, [saveContent]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-transparent relative h-full w-full">
      {!isEditorReady && !isBinaryWarning && !loadError && (
        <div className="absolute inset-0 z-20 flex flex-col bg-transparent">
          <div className="flex-1 p-6 space-y-4">
            <div className="h-3 w-1/3 bg-[var(--material-surface)] rounded-full animate-pulse" />
            <div className="h-3 w-1/2 bg-[var(--material-surface)] rounded-full animate-pulse" />
            <div className="h-3 w-1/4 bg-[var(--material-surface)] rounded-full animate-pulse" />
            <div className="h-3 w-2/3 bg-[var(--material-surface)] rounded-full animate-pulse" />
          </div>
        </div>
      )}

      {loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-transparent px-6 text-center text-[var(--color-text-primary)] select-none">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-control bg-[var(--material-surface)] text-[var(--color-text-muted)]">
            <Icons.AlertTriangle size={38} stroke={1.2} />
          </div>
          <h3 className="mb-2 text-[16px] font-semibold text-[var(--color-text-highlight)]">
            {loadError.code === "file_too_large"
              ? t("editor.fileTooLarge")
              : t("editor.cannotOpen")}
          </h3>
          <p className="max-w-[520px] text-[13px] leading-relaxed text-[var(--color-text-muted)]">
            {loadError.message}
          </p>
        </div>
      ) : isBinaryWarning ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-transparent text-[var(--color-text-primary)] select-none px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-control bg-[var(--material-surface)] text-[var(--color-text-muted)] mb-6">
            <Icons.FileCode size={40} stroke={1} />
          </div>
          <h3 className="text-[16px] font-semibold text-[var(--color-text-highlight)] mb-2">
            {t("editor.binaryWarningTitle")}
          </h3>
          <p className="text-[13px] text-[var(--color-text-muted)] mb-8 max-w-[420px] leading-relaxed">
            {t("editor.binaryWarningMessage")}
          </p>
          <button
            type="button"
            onClick={() => {
              setIsBinaryWarning(false);
              loadContent(path, true);
            }}
            className="px-6 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded-control font-medium transition-colors cursor-pointer"
          >
            {t("editor.forceOpenAction")}
          </button>
        </div>
      ) : (
        <div
          className={`relative flex flex-1 flex-col overflow-hidden bg-transparent transition-opacity duration-300 ${isEditorReady ? "opacity-100" : "opacity-0"}`}
        >
          {isEditorReady && (
            <>
              <EditorBreadcrumb path={path} language={GetLanguageFromPath(path)} />
              <div className="relative min-h-0 flex-1">
                <div
                  className="h-full"
                  style={{ display: viewMode === "preview" ? "none" : undefined }}
                >
                  <AuronaEngine
                    key={editorKey}
                    value={fileContent}
                    language={GetLanguageFromPath(path)}
                    isActive={isActive && viewMode === "source"}
                    focusRequest={focusRequest}
                    onChange={handleContentChange}
                    path={path}
                    initialViewState={persistedViewState}
                    onViewStateChange={handleViewStateChange}
                    externalContent={externalContent}
                    revealLine={revealLine}
                    onRevealHandled={onRevealHandled}
                    onSyncError={setSyncError}
                  />
                </div>
                {isMarkdown && viewMode === "preview" && (
                  <MarkdownPreview
                    content={fileContent}
                    path={path}
                    initialScrollTop={previewScrollTop.current}
                    onScrollTopChange={(scrollTop) => {
                      previewScrollTop.current = scrollTop;
                      const base = pendingViewStateRef.current ??
                        loadEditorViewState(path) ?? {
                          path,
                          line: 1,
                          column: 1,
                          scrollTop: 0,
                          scrollLeft: 0,
                        };
                      scheduleViewStateSave({
                        ...base,
                        path,
                        mode: viewMode,
                        previewScrollTop: scrollTop,
                      });
                    }}
                  />
                )}
                {isMarkdown && isActive && capsuleEnabled && (
                  <EditorCapsule
                    mode={viewMode}
                    onModeChange={changeViewMode}
                    sourceLabel={t("editor.sourceView")}
                    previewLabel={t("editor.previewView")}
                    capsuleLabel={t("editor.capsuleLabel")}
                    dirtyLabel={t("workspace.unsavedTitle")}
                    fileName={getFileName(path)}
                    filePath={path}
                    language={GetLanguageFromPath(path)}
                    isDirty={isDirty}
                    copyPathLabel={t("editorTabBar.copyPath")}
                    onCopyPath={() => void handleCopyPath()}
                  />
                )}
              </div>
            </>
          )}
          {isSaving && (
            <div className="glass-layer-overlay absolute right-3 bottom-3 rounded-overlay border border-[var(--border-overlay)] bg-[var(--material-overlay)] px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] backdrop-blur-[var(--glass-blur-overlay)] backdrop-saturate-[var(--GlassSaturation)]">
              正在保存...
            </div>
          )}
        </div>
      )}
    </div>
  );
});
