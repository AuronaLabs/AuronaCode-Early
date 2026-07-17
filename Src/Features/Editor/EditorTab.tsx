import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileSystemService } from "../../Core/FileSystemService";
import { DesktopError } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { EditorIPC } from "../../Foundation/IPC/EditorCommands";
import { isBinaryExtension } from "../../Shared/Constants/FileTypes";
import { GetLanguageFromPath } from "../../Shared/Utils/LanguageUtils";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";

import { AuronaEngine } from "./AuronaEngine";
import { RecoveryCoordinator } from "./Model/RecoveryCoordinator";
import { type RecoverySnapshot, RecoveryStore } from "./Model/RecoveryStore";

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

export const EditorTab = React.memo(function EditorTab({
  path,
  isActive,
  revealLine,
  onRevealHandled,
}: EditorTabProps) {
  const [fileContent, setFileContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isBinaryWarning, setIsBinaryWarning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [syncError, setSyncError] = useState<Error | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [diskFingerprint, setDiskFingerprint] = useState("");
  const [pendingRecovery, setPendingRecovery] = useState<RecoverySnapshot | null>(null);
  const [loadError, setLoadError] = useState<{ code?: string; message: string } | null>(null);
  const loadedPathRef = useRef<string | null>(null);
  const contentRef = useRef("");
  const savedContentRef = useRef("");
  const saveInFlightRef = useRef<Promise<void> | null>(null);

  const isDirty = fileContent !== savedContent;

  const loadContent = useCallback(async (filePath: string, force = false) => {
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
      EditorIPC.clearSyncError(filePath);
      setIsEditorReady(false);
      const snapshot = await EditorIPC.open(filePath);
      const content = snapshot.text;
      setDiskFingerprint(snapshot.diskFingerprint);
      setPendingRecovery(await RecoveryStore.load(filePath));
      setFileContent(content);
      setSavedContent(content);
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
  }, []);

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
        const response = await EditorIPC.save(path);
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

  const handleRestoreRecovery = useCallback(async () => {
    if (!pendingRecovery) return;
    try {
      await EditorIPC.applyEdit(path, 0, contentRef.current.length, pendingRecovery.text);
      contentRef.current = pendingRecovery.text;
      setFileContent(pendingRecovery.text);
      setPendingRecovery(null);
      showToast("已恢复本地编辑快照", "success");
    } catch (error) {
      setSyncError(error instanceof Error ? error : new Error(String(error)));
    }
  }, [path, pendingRecovery]);

  const handleIgnoreRecovery = useCallback(async () => {
    await RecoveryStore.remove(path);
    setPendingRecovery(null);
  }, [path]);

  const handleReloadAfterSyncError = useCallback(async () => {
    try {
      RecoveryCoordinator.update(path, contentRef.current, diskFingerprint, true);
      await RecoveryCoordinator.flush(path);
      setIsEditorReady(false);
      await EditorIPC.close(path, true);
      EditorIPC.clearSyncError(path);
      setSyncError(null);
      await loadContent(path, true);
      setEditorKey((key) => key + 1);
      showToast("已从磁盘重新加载文件", "success");
    } catch (error) {
      showToast(`重新加载失败：${FileSystemService.toMessage(error)}`, "error");
      setIsEditorReady(true);
    }
  }, [diskFingerprint, loadContent, path]);

  const handleCopyLocalContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(contentRef.current);
      showToast("已复制当前本地内容", "success");
    } catch (error) {
      showToast(`复制失败：${FileSystemService.toMessage(error)}`, "error");
    }
  }, []);

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
      void EditorIPC.close(path, true).catch(console.error);
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
            <div className="h-3 w-1/3 bg-[var(--GlassSurface-Elevated)] rounded-full animate-pulse" />
            <div className="h-3 w-1/2 bg-[var(--GlassSurface-Elevated)] rounded-full animate-pulse" />
            <div className="h-3 w-1/4 bg-[var(--GlassSurface-Elevated)] rounded-full animate-pulse" />
            <div className="h-3 w-2/3 bg-[var(--GlassSurface-Elevated)] rounded-full animate-pulse" />
          </div>
        </div>
      )}

      {loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-transparent px-6 text-center text-[var(--TextPrimary)] select-none">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--GlassSurface-Elevated)] text-[var(--TextMuted)]">
            <Icons.AlertTriangle size={38} stroke={1.2} />
          </div>
          <h3 className="mb-2 text-[16px] font-semibold text-[var(--TextHighlight)]">
            {loadError.code === "file_too_large" ? "文件超出安全编辑范围" : "无法打开文件"}
          </h3>
          <p className="max-w-[520px] text-[13px] leading-relaxed text-[var(--TextMuted)]">
            {loadError.message}
          </p>
        </div>
      ) : isBinaryWarning ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-transparent text-[var(--TextPrimary)] select-none px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--GlassSurface-Elevated)] text-[var(--TextMuted)] mb-6">
            <Icons.FileCode size={40} stroke={1} />
          </div>
          <h3 className="text-[16px] font-semibold text-[var(--TextHighlight)] mb-2">
            无法显示此文件
          </h3>
          <p className="text-[13px] text-[var(--TextMuted)] mb-8 max-w-[420px] leading-relaxed">
            该文件可能是二进制文件，或使用了暂不支持的文本编码强行在编辑器中打开可能会导致乱码或性能问题
          </p>
          <button
            type="button"
            onClick={() => {
              setIsBinaryWarning(false);
              loadContent(path, true);
            }}
            className="px-6 py-2 bg-[var(--AccentPrimary)] hover:bg-[var(--AccentHover)] text-white rounded-lg font-medium transition-colors cursor-pointer"
          >
            仍然强制打开
          </button>
        </div>
      ) : (
        <div
          className={`flex-1 overflow-hidden relative bg-transparent transition-opacity duration-300 ${isEditorReady ? "opacity-100" : "opacity-0"}`}
        >
          {isEditorReady && (
            <AuronaEngine
              key={editorKey}
              value={fileContent}
              language={GetLanguageFromPath(path)}
              isActive={isActive}
              onChange={handleContentChange}
              path={path}
              revealLine={revealLine}
              onRevealHandled={onRevealHandled}
              onSyncError={setSyncError}
            />
          )}
          {syncError && (
            <div className="absolute inset-x-3 top-3 z-30 flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-300 shadow-lg">
              <span className="min-w-0 truncate">
                编辑同步失败，已阻止保存以避免覆盖未同步内容。
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleCopyLocalContent()}
                  className="rounded-lg px-2 py-1 font-medium hover:bg-red-500/15"
                >
                  复制本地内容
                </button>
                <button
                  type="button"
                  onClick={handleReloadAfterSyncError}
                  className="rounded-lg px-2 py-1 font-medium hover:bg-red-500/15"
                >
                  从磁盘重新加载
                </button>
              </span>
            </div>
          )}
          {pendingRecovery && !syncError && (
            <div className="absolute inset-x-3 top-3 z-30 flex items-center justify-between gap-3 rounded-xl border border-[var(--border-overlay)] bg-[var(--material-overlay)] px-3 py-2 text-[12px] text-[var(--TextPrimary)] shadow-[var(--shadow-overlay)]">
              <span className="min-w-0 truncate">检测到未保存的本地恢复快照</span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={handleIgnoreRecovery}
                  className="rounded-lg px-2 py-1 hover:bg-[var(--material-interactive-hover)]"
                >
                  忽略
                </button>
                <button
                  type="button"
                  onClick={handleRestoreRecovery}
                  className="rounded-lg bg-[var(--AccentPrimary)] px-2 py-1 font-medium text-white"
                >
                  恢复内容
                </button>
              </span>
            </div>
          )}
          {isSaving && (
            <div className="absolute right-3 bottom-3 rounded-lg border border-[var(--GlassBorder)] bg-[var(--GlassSurface)] backdrop-blur-[var(--glass-blur-floating)] px-3 py-1.5 text-[12px] text-[var(--TextMuted)] shadow-lg">
              正在保存...
            </div>
          )}
        </div>
      )}
    </div>
  );
});
