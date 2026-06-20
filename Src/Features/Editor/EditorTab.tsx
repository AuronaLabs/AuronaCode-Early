import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Icons } from "../../UI/Icons/IconManager";
import { EventBus } from "../../Core/EventBus";
import { FileSystemService } from "../../Core/FileSystemService";
import { showToast } from "../../UI/Feedback/Toast";
import { GetLanguageFromPath } from "../../Shared/Utils/LanguageUtils";

const MonacoEngine = lazy(() => import("./MonacoEngine").then((module) => ({ default: module.MonacoEngine })));

type EditorTabProps = {
  path: string;
  isActive: boolean;
};

const BINARY_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".exe",
  ".dll",
  ".bin",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".pdf",
  ".ttf",
  ".woff",
  ".woff2",
  ".mp4",
  ".mp3",
  ".db",
  ".sqlite",
];

const getExtension = (filePath: string) => {
  const index = filePath.lastIndexOf(".");
  return index >= 0 ? filePath.slice(index).toLowerCase() : "";
};

export function EditorTab({ path, isActive }: EditorTabProps) {
  const [fileContent, setFileContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isBinaryWarning, setIsBinaryWarning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const loadedPathRef = useRef<string | null>(null);
  const contentRef = useRef("");
  const savedContentRef = useRef("");

  const isDirty = fileContent !== savedContent;

  const loadContent = useCallback(async (filePath: string, force = false) => {
    try {
      const ext = getExtension(filePath);
      if (!force && BINARY_EXTENSIONS.includes(ext)) {
        setIsBinaryWarning(true);
        setFileContent("");
        setSavedContent("");
        EventBus.emit("editor:dirty-changed", { path: filePath, isDirty: false });
        return;
      }

      setIsBinaryWarning(false);
      setIsEditorReady(false);
      const content = await FileSystemService.readTextFile(filePath);
      setFileContent(content);
      setSavedContent(content);
      contentRef.current = content;
      savedContentRef.current = content;
      setIsEditorReady(true);
      EventBus.emit("editor:dirty-changed", { path: filePath, isDirty: false });
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
      EventBus.emit("editor:dirty-changed", { path: filePath, isDirty: false });
    }
  }, []);

  const saveContent = useCallback(async () => {
    if (!isActive || isBinaryWarning || isSaving) return;
    if (contentRef.current === savedContentRef.current) {
      return;
    }

    try {
      setIsSaving(true);
      await FileSystemService.writeTextFile(path, contentRef.current);
      savedContentRef.current = contentRef.current;
      setSavedContent(contentRef.current);
      EventBus.emit("editor:dirty-changed", { path, isDirty: false });
      EventBus.emit("editor:file-saved", { path });
    } catch (error) {
      showToast(`保存失败：${FileSystemService.toMessage(error)}`, "error");
    } finally {
      setIsSaving(false);
    }
  }, [isActive, isBinaryWarning, isSaving, path]);

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
    EventBus.emit("editor:dirty-changed", { path, isDirty });
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
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--ColorEditor)] relative h-full w-full">
      {!isEditorReady && !isBinaryWarning && (
        <div className="absolute inset-0 z-20 flex flex-col bg-[var(--ColorEditor)]">
          <div className="flex-1 p-6 space-y-4">
            <div className="h-3 w-1/3 bg-slate-100 dark:bg-white/10 rounded-full animate-pulse" />
            <div className="h-3 w-1/2 bg-slate-100 dark:bg-white/10 rounded-full animate-pulse" />
            <div className="h-3 w-1/4 bg-slate-100 dark:bg-white/10 rounded-full animate-pulse" />
            <div className="h-3 w-2/3 bg-slate-100 dark:bg-white/10 rounded-full animate-pulse" />
          </div>
        </div>
      )}

      {isBinaryWarning ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-[var(--ColorEditor)] text-[var(--ColorText)] select-none px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-black/5 dark:bg-white/5 text-[var(--ColorMuted)] mb-6">
            <Icons.FileCode size={40} stroke={1} />
          </div>
          <h3 className="text-[16px] font-semibold text-[var(--ColorTextHighlight)] mb-2">无法显示此文件</h3>
          <p className="text-[13px] text-[var(--ColorMuted)] mb-8 max-w-[420px] leading-relaxed">
            该文件可能是二进制文件，或使用了暂不支持的文本编码强行在编辑器中打开可能会导致乱码或性能问题
          </p>
          <button
            onClick={() => {
              setIsBinaryWarning(false);
              loadContent(path, true);
            }}
            className="px-6 py-2 bg-[var(--ColorAccent)] hover:bg-[var(--ColorAccentHover)] text-white rounded-md font-medium transition-colors cursor-pointer"
          >
            仍然强制打开
          </button>
        </div>
      ) : (
        <div className={`flex-1 overflow-hidden relative bg-[var(--ColorEditor)] transition-opacity duration-300 ${isEditorReady ? "opacity-100" : "opacity-0"}`}>
          <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-slate-400">Loading Editor Engine...</div>}>
            <MonacoEngine
              value={fileContent}
              language={GetLanguageFromPath(path)}
              isActive={isActive}
              onChange={setFileContent}
              path={path}
              fontSize={Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--EditorFontSize")) || 14}
              lineHeight={Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--EditorLineHeight")) || 24}
            />
          </Suspense>
          {isSaving && (
            <div className="absolute right-3 bottom-3 rounded-md border border-[var(--ColorPanelBorder)] bg-[var(--ColorEditor)] px-3 py-1.5 text-[12px] text-[var(--ColorMuted)] shadow-lg">
              正在保存...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
