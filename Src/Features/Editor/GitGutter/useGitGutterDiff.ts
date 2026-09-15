import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentService } from "../../../Core/DocumentService";
import { GitService, type SourceControlCache } from "../../../Core/GitService";
import { EventBus } from "../../../Foundation/EventBus";
import { createEmptyDiffState, parseUnifiedDiffHunks } from "./parseUnifiedDiff";

export interface GitGutterDiffState {
  addedLines: Set<number>;
  modifiedLines: Set<number>;
  deletedLines: Set<number>;
}

const REFRESH_DEBOUNCE_MS = 800;

/** 将编辑器绝对路径转换为 repo 相对路径（git 侧使用 `/` 分隔符） */
function toRepoRelative(filePath: string, repoPath: string): string | null {
  const normalizedFile = filePath.replace(/\\/g, "/");
  const normalizedRepo = repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedFile.startsWith(`${normalizedRepo}/`)) return null;
  return normalizedFile.slice(normalizedRepo.length + 1);
}

export function useGitGutterDiff(path?: string): GitGutterDiffState {
  const [diffState, setDiffState] = useState<GitGutterDiffState>(createEmptyDiffState());
  const repoPathRef = useRef<string | null>(null);
  // 缓存：savedVersion 未变时不重发 diff 请求
  const cacheRef = useRef<{ savedVersion: number; state: GitGutterDiffState } | null>(null);
  const debounceRef = useRef<number | null>(null);
  const generationRef = useRef(0);

  const compute = useCallback(async (filePath: string, savedVersion: number) => {
    const repoPath = repoPathRef.current;
    const relative = repoPath ? toRepoRelative(filePath, repoPath) : null;
    if (!repoPath || !relative) {
      cacheRef.current = { savedVersion, state: createEmptyDiffState() };
      setDiffState(createEmptyDiffState());
      return;
    }
    try {
      const diffText = await GitService.getDiffCached(repoPath, relative);
      const state = parseUnifiedDiffHunks(diffText);
      cacheRef.current = { savedVersion, state };
      setDiffState(state);
    } catch {
      cacheRef.current = { savedVersion, state: createEmptyDiffState() };
      setDiffState(createEmptyDiffState());
    }
  }, []);

  useEffect(() => {
    if (!path) {
      setDiffState(createEmptyDiffState());
      cacheRef.current = null;
      return;
    }
    const generation = ++generationRef.current;

    const refresh = (force: boolean, savedVersion: number) => {
      if (generation !== generationRef.current) return;
      if (!force && cacheRef.current?.savedVersion === savedVersion) return;
      void compute(path, savedVersion);
    };

    const scheduleRefresh = (savedVersion: number) => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        refresh(true, savedVersion);
      }, REFRESH_DEBOUNCE_MS);
    };

    // 1. 订阅文档记录：savedVersion 变化（保存）后防抖刷新；编辑触发的记录变化直接跳过
    const unsubDocument = DocumentService.subscribe(path, (record) => {
      if (record?.openState !== "open") return;
      if (cacheRef.current?.savedVersion === record.savedVersion) return;
      scheduleRefresh(record.savedVersion);
    });

    // 2. 订阅 GitService：仓库缓存就绪/切换后重算
    const unsubGit = GitService.subscribe((cache: SourceControlCache | null) => {
      if (generation !== generationRef.current) return;
      repoPathRef.current = cache?.isRepo ? (cache.repoPath ?? null) : null;
      const savedVersion = DocumentService.get(path)?.savedVersion ?? -1;
      refresh(true, savedVersion);
    });

    // 3. 订阅 git 变动事件：任何 git 操作后重算
    const unsubEvent = EventBus.on("git:changes-count", () => {
      if (generation !== generationRef.current) return;
      const savedVersion = DocumentService.get(path)?.savedVersion ?? -1;
      refresh(true, savedVersion);
    });

    return () => {
      generationRef.current += 1;
      unsubDocument();
      unsubGit();
      unsubEvent();
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [path, compute]);

  return diffState;
}
