import React, { useCallback, useEffect, useRef, useState } from "react";
import { DocumentService } from "../../Core/DocumentService";
import { FileSystemService } from "../../Core/FileSystemService";
import { RecoveryCoordinator } from "../../Core/Recovery/RecoveryCoordinator";
import { RecoveryStore } from "../../Core/Recovery/RecoveryStore";
import { DesktopError } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { isBinaryExtension } from "../../Shared/Constants/FileTypes";
import { GetLanguageFromPath } from "../../Shared/Utils/LanguageUtils";
import { showNotification, showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { AuronaEngine } from "./AuronaEngine";
import { EditorBreadcrumb } from "./components/EditorBreadcrumb";

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
  const [externalContent, setExternalContent] = useState<{
    content: string;
    nonce: number;
  } | null>(null);
  const [loadError, setLoadError] = useState<{ code?: string; message: string } | null>(null);
  const loadedPathRef = useRef<string | null>(null);
  const contentRef = useRef("");
  const savedContentRef = useRef("");
  const saveInFlightRef = useRef<Promise<void> | null>(null);

  const isDirty = fileContent !== savedContent;

  const loadContent = useCallback(
    async (filePath: string, force = false) => {
      try {
        const ext = getExtension(filePath);
        if (!force && isBinaryExtension(ext)) {
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
        const content = document.content;
        const recovery = await RecoveryStore.load(filePath);
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
                    await DocumentService.applyEdit(
                      filePath,
                      0,
                      contentRef.current.length,
                      recovery.text,
                      recovery.text,
                    );
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
        if (!record || record.content === contentRef.current) return;
        setExternalContent({ content: record.content, nonce: Date.now() });
      }),
    [path],
  );

  const saveContent = useCallback(async () => {
    if (!isActive || isBinaryWarning) return;
    if (saveInFlightRef.current) return saveInFlightRef.current;
    if (contentRef.current === savedContentRef.current) {
      return;
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
        } else {
          RecoveryCoordinator.update(path, contentRef.current, response.diskFingerprint, true);
          await RecoveryCoordinator.flush(path);
          EventBus.emit("editor:dirty-set", { path });
        }
      } catch (error) {
        setSyncError(error instanceof Error ? error : new Error(String(error)));
        showToast(`保存失败：${FileSystemService.toMessage(error)}`, "error");
      } finally {
        setIsSaving(false);
      }
    })();
    saveInFlightRef.current = saving;
    try {
      await saving;
    } finally {
      if (saveInFlightRef.current === saving) saveInFlightRef.current = null;
    }
  }, [isActive, isBinaryWarning, path]);

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
    return EventBus.on("app:save-file", saveContent);
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
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--material-surface)] text-[var(--color-text-muted)]">
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
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--material-surface)] text-[var(--color-text-muted)] mb-6">
            <Icons.FileCode size={40} stroke={1} />
          </div>
          <h3 className="text-[16px] font-semibold text-[var(--color-text-highlight)] mb-2">
            无法显示此文件
          </h3>
          <p className="text-[13px] text-[var(--color-text-muted)] mb-8 max-w-[420px] leading-relaxed">
            该文件可能是二进制文件，或使用了暂不支持的文本编码强行在编辑器中打开可能会导致乱码或性能问题
          </p>
          <button
            type="button"
            onClick={() => {
              setIsBinaryWarning(false);
              loadContent(path, true);
            }}
            className="px-6 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded-lg font-medium transition-colors cursor-pointer"
          >
            仍然强制打开
          </button>
        </div>
      ) : (
        <div
          className={`relative flex flex-1 flex-col overflow-hidden bg-transparent transition-opacity duration-300 ${isEditorReady ? "opacity-100" : "opacity-0"}`}
        >
          {isEditorReady && (
            <>
              <EditorBreadcrumb path={path} language={GetLanguageFromPath(path)} />
              <div className="min-h-0 flex-1">
                <AuronaEngine
                  key={editorKey}
                  value={fileContent}
                  language={GetLanguageFromPath(path)}
                  isActive={isActive}
                  onChange={handleContentChange}
                  path={path}
                  externalContent={externalContent}
                  revealLine={revealLine}
                  onRevealHandled={onRevealHandled}
                  onSyncError={setSyncError}
                />
              </div>
            </>
          )}
          {isSaving && (
            <div className="absolute right-3 bottom-3 rounded-lg border border-[var(--border-overlay)] bg-[var(--material-overlay)] px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] backdrop-blur-[var(--glass-blur-floating)]">
              正在保存...
            </div>
          )}
        </div>
      )}
    </div>
  );
});
