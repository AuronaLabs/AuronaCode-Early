import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FliunoCoreResult,
  type FliunoScope,
  FliunoSearchSession,
  queryForScope,
} from "../../../Core/Fliuno/FliunoCore";
import {
  FLIUNO_RECENT_COMMANDS_KEY,
  FLIUNO_RECENT_FILES_KEY,
  LEGACY_RECENT_KEY,
  readHistory,
  writeHistory,
} from "../../../Core/Fliuno/history";
import { NavigationHistory } from "../../../Core/NavigationHistory";
import { WorkspaceService } from "../../../Core/WorkspaceService";
import { CommandRegistry } from "../../../Extension/CommandRegistry";
import { EventBus } from "../../../Foundation/EventBus";
import {
  type WorkspaceFileEntry,
  WorkspaceSearchIPC,
} from "../../../Foundation/IPC/WorkspaceSearchCommands";
import { UserConfigStore } from "../../../Foundation/Storage/UserConfigStore";
import { GetLanguageFromPath } from "../../../Shared/Utils/LanguageUtils";
import { useEditorStore } from "../../../State/useEditorStore";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";

export const FLIUNO_SEARCH_DEBOUNCE_MS = 120;
const FLIUNO_RECENT_LIMIT = 30;

export interface UseFliunoSearchOptions {
  /** 悬浮窗关闭时暂停索引与搜索 */
  enabled?: boolean;
  excludedCommandId: string;
}

/**
 * Modal 与工作区页共用的搜索编排：debounce、session.cancel、文件索引、
 * 大小写/正则持久化与最近记录。双模式除 excludedCommandId 外行为完全一致。
 */
export function useFliunoSearch({ enabled = true, excludedCommandId }: UseFliunoSearchOptions) {
  const sessionRef = useRef<FliunoSearchSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new FliunoSearchSession();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexedRootRef = useRef<string | null>(null);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<FliunoScope>("all");
  const [results, setResults] = useState<FliunoCoreResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentCommands, setRecentCommands] = useState(() =>
    readHistory(FLIUNO_RECENT_COMMANDS_KEY, LEGACY_RECENT_KEY),
  );
  const [recentFiles, setRecentFiles] = useState(() => readHistory(FLIUNO_RECENT_FILES_KEY));
  const [workspaceRoot, setWorkspaceRoot] = useState(
    () => WorkspaceService.getCurrent().primaryRoot,
  );
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [contentCaseSensitive, setContentCaseSensitive] = useState(false);
  const [contentRegex, setContentRegex] = useState(false);
  const [fileIndexState, setFileIndexState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [fileIndexError, setFileIndexError] = useState<string | null>(null);

  // 内容搜索大小写/正则：默认值来自设置，切换即持久化
  useEffect(() => {
    let mounted = true;
    UserConfigStore.get()
      .then((config) => {
        if (!mounted) return;
        setContentCaseSensitive(config.fliunoSearchCaseSensitive ?? false);
        setContentRegex(config.fliunoSearchRegex ?? false);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const toggleCaseSensitive = useCallback(() => {
    setContentCaseSensitive((value) => {
      void UserConfigStore.set({ fliunoSearchCaseSensitive: !value });
      return !value;
    });
  }, []);

  const toggleRegex = useCallback(() => {
    setContentRegex((value) => {
      void UserConfigStore.set({ fliunoSearchRegex: !value });
      return !value;
    });
  }, []);

  const loadFiles = useCallback(async (root: string) => {
    setFileIndexState("loading");
    setFileIndexError(null);
    try {
      setFiles(await WorkspaceSearchIPC.listFiles(root));
      setFileIndexState("ready");
    } catch (error) {
      setFiles([]);
      setFileIndexState("error");
      setFileIndexError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(
    () =>
      WorkspaceService.subscribe((workspace) => {
        indexedRootRef.current = null;
        setFiles([]);
        setFileIndexState("idle");
        setFileIndexError(null);
        setWorkspaceRoot(workspace.primaryRoot);
      }),
    [],
  );

  useEffect(() => {
    if (enabled && workspaceRoot && indexedRootRef.current !== workspaceRoot) {
      indexedRootRef.current = workspaceRoot;
      void loadFiles(workspaceRoot);
    }
  }, [enabled, loadFiles, workspaceRoot]);

  useEffect(
    () =>
      EventBus.on("fs:changed", () => {
        if (enabled && workspaceRoot) void loadFiles(workspaceRoot);
      }),
    [enabled, loadFiles, workspaceRoot],
  );

  const runSearch = useCallback(
    (nextQuery: string, nextScope: FliunoScope) => {
      if (!enabled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const session = sessionRef.current;
        if (!session) return;
        session.cancel();
        setSelectedIndex(-1);
        const workbench = useWorkbenchStore.getState();
        const activeTab = workbench.tabs.find((tab) => tab.id === workbench.activeTabId);
        const activeFilePath = activeTab?.type === "file" ? activeTab.path : undefined;
        const openFileTabs = workbench.tabs
          .filter((tab) => tab.type === "file" && tab.path)
          .map((tab) => ({
            path: tab.path as string,
            language: GetLanguageFromPath(tab.path as string),
          }));
        void session
          .search({
            query: nextQuery,
            scope: nextScope,
            commands: CommandRegistry.getCommands(),
            files,
            recentCommands,
            recentFiles,
            openFiles: openFileTabs.map((tab) => tab.path),
            openFileTabs,
            activeFilePath,
            activeLanguage: useEditorStore.getState().editorStatus.language,
            workspaceRoot: workspaceRoot || undefined,
            contentCaseSensitive,
            contentRegex,
            excludedCommandId,
          })
          .then(setResults);
      }, FLIUNO_SEARCH_DEBOUNCE_MS);
    },
    [
      contentCaseSensitive,
      contentRegex,
      enabled,
      excludedCommandId,
      files,
      recentCommands,
      recentFiles,
      workspaceRoot,
    ],
  );

  useEffect(() => {
    runSearch(query, scope);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, runSearch, scope]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      sessionRef.current?.cancel();
    },
    [],
  );

  const selectScope = useCallback((nextScope: FliunoScope) => {
    setScope(nextScope);
    setQuery((current) => queryForScope(current, nextScope));
    setSelectedIndex(-1);
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    sessionRef.current?.cancel();
  }, []);

  const pushRecentCommand = useCallback((id: string) => {
    setRecentCommands((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, FLIUNO_RECENT_LIMIT);
      writeHistory(FLIUNO_RECENT_COMMANDS_KEY, next);
      return next;
    });
  }, []);

  const pushRecentFile = useCallback((path: string) => {
    setRecentFiles((current) => {
      const next = [path, ...current.filter((item) => item !== path)].slice(0, FLIUNO_RECENT_LIMIT);
      writeHistory(FLIUNO_RECENT_FILES_KEY, next);
      return next;
    });
  }, []);

  return {
    query,
    setQuery,
    scope,
    setScope,
    results,
    setResults,
    selectedIndex,
    setSelectedIndex,
    workspaceRoot,
    files,
    contentCaseSensitive,
    toggleCaseSensitive,
    contentRegex,
    toggleRegex,
    fileIndexState,
    fileIndexError,
    recentCommands,
    recentFiles,
    pushRecentCommand,
    pushRecentFile,
    selectScope,
    cancel,
  };
}

/** 双模式共用的结果执行：最近记录通过 push 回调注入（modal 额外负责关闭自身）。 */
export function executeFliunoResult(
  result: FliunoCoreResult,
  push: { command: (id: string) => void; file: (path: string) => void },
): void {
  const workbench = useWorkbenchStore.getState();
  switch (result.action) {
    case "executeCommand":
      if (result.commandId) {
        void CommandRegistry.execute(result.commandId);
        push.command(result.commandId);
      }
      break;
    case "openFile":
      if (result.targetPath) {
        workbench.openFile(result.targetPath);
        push.file(result.targetPath);
      }
      break;
    case "openSettings":
      workbench.openSettings(result.settingCategory, result.settingId);
      break;
    case "revealSymbol":
    case "revealContent":
      if (result.targetPath) {
        const editor = useEditorStore.getState().editorStatus;
        if (editor.path) {
          NavigationHistory.record({
            path: editor.path,
            line: editor.line,
            character: editor.column,
          });
        }
        workbench.openFile(result.targetPath);
        const targetLine = result.targetLine ?? 1;
        workbench.requestReveal(result.targetPath, targetLine);
        NavigationHistory.record({ path: result.targetPath, line: targetLine });
      }
      break;
    case "customExtension":
      if (result.onSelect) {
        void result.onSelect();
      }
      break;
  }
}
