import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileSystemService } from "../../Core/FileSystemService";
import { EventBus } from "../../Foundation/EventBus";
import { EditorIPC } from "../../Foundation/IPC/EditorCommands";
import { isBinaryExtension } from "../../Shared/Constants/FileTypes";
import { GetLanguageFromPath } from "../../Shared/Utils/LanguageUtils";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";

import { AuronaEngine } from "./AuronaEngine";

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
  const loadedPathRef = useRef<string | null>(null);
  const contentRef = useRef("");
  const savedContentRef = useRef("");

  const isDirty = fileContent !== savedContent;

  const loadContent = useCallback(async (filePath: string, force = false) => {
    try {
      const ext = getExtension(filePath);
      if (!force && isBinaryExtension(ext)) {
        setIsBinaryWarning(true);
        setFileContent("");
        setSavedContent("");
        EventBus.emit("editor:dirty-cleared", { path: filePath });
        return;
      }

      setIsBinaryWarning(false);
      setSyncError(null);
      EditorIPC.clearSyncError(filePath);
      setIsEditorReady(false);
      const content = await FileSystemService.readTextFile(filePath);
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
        setFileContent(`无法读取文件内容，或该文件不是文本文件\n错误：${message}`);
        setSavedContent("");
        setIsEditorReady(true);
      }
      EventBus.emit("editor:dirty-cleared", { path: filePath });
    }
  }, []);

  const saveContent = useCallback(async () => {
    if (!isActive || isBinaryWarning || isSaving) return;
    if (contentRef.current === savedContentRef.current) {
      return;
    }

    try {
      setIsSaving(true);
      await EditorIPC.waitForIdle(path);
      await EditorIPC.save(path);
      savedContentRef.current = contentRef.current;
      setSavedContent(contentRef.current);
      EventBus.emit("editor:dirty-cleared", { path });
      EventBus.emit("editor:file-saved", { path });
    } catch (error) {
      setSyncError(error instanceof Error ? error : new Error(String(error)));
      showToast(`保存失败：${FileSystemService.toMessage(error)}`, "error");
    } finally {
      setIsSaving(false);
    }
  }, [isActive, isBinaryWarning, isSaving, path]);

  const handleContentChange = useCallback((content: string) => {
    contentRef.current = content;
    setFileContent(content);
  }, []);

  const handleReloadAfterSyncError = useCallback(async () => {
    try {
      setIsEditorReady(false);
      await EditorIPC.close(path);
      EditorIPC.clearSyncError(path);
      setSyncError(null);
      await loadContent(path, true);
      setEditorKey((key) => key + 1);
      showToast("已从磁盘重新加载文件", "success");
    } catch (error) {
      showToast(`重新加载失败：${FileSystemService.toMessage(error)}`, "error");
      setIsEditorReady(true);
    }
  }, [loadContent, path]);

  useEffect(() => {
    if (path !== loadedPathRef.current) {
      setIsBinaryWarning(false);
      setIsEditorReady(false);
      loadedPathRef.current = path;
      loadContent(path);
    }
  }, [loadContent, path]);

  useEffect(() => {
    contentRef.current = fileContent;
    savedContentRef.current = savedContent;
    const ev = isDirty ? "editor:dirty-set" : "editor:dirty-cleared";
    EventBus.emit(ev, { path });
  }, [fileContent, isDirty, path, savedContent]);

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
      {!isEditorReady && !isBinaryWarning && (
        <div className="absolute inset-0 z-20 flex flex-col bg-transparent">
          <div className="flex-1 p-6 space-y-4">
            <div className="h-3 w-1/3 bg-[var(--GlassSurface-Elevated)] rounded-full animate-pulse" />
            <div className="h-3 w-1/2 bg-[var(--GlassSurface-Elevated)] rounded-full animate-pulse" />
            <div className="h-3 w-1/4 bg-[var(--GlassSurface-Elevated)] rounded-full animate-pulse" />
            <div className="h-3 w-2/3 bg-[var(--GlassSurface-Elevated)] rounded-full animate-pulse" />
          </div>
        </div>
      )}

      {isBinaryWarning ? (
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
          {syncError && (
            <div className="absolute inset-x-3 top-3 z-30 flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-300 shadow-lg">
              <span className="min-w-0 truncate">
                编辑同步失败，已阻止保存以避免覆盖未同步内容。
              </span>
              <button
                type="button"
                onClick={handleReloadAfterSyncError}
                className="shrink-0 rounded-lg px-2 py-1 font-medium hover:bg-red-500/15"
              >
                从磁盘重新加载
              </button>
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
