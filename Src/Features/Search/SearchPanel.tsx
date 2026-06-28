import React, { useEffect, useState, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Icons } from "../../UI/Icons/IconManager";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { EventBus } from "../../Foundation/EventBus";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Input } from "../../UI/Components/Input";

export interface SearchResult {
  file_path: string;
  line_number: number;
  match_text: string;
  index: number;
}

export const SearchPanel = React.memo(function SearchPanel() {
  const [query, setQuery] = useState("");
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [repoPath, setRepoPath] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const config = await WorkspaceStore.get();
      if (config.lastOpenedPath) {
        setRepoPath(config.lastOpenedPath);
      }
    };
    init();

    const unsub = EventBus.on("workspace:root-changed", (path: string) => {
      setRepoPath(path);
      setResults([]);
      setHasSearched(false);
    });
    return () => unsub();
  }, []);

  const handleSearch = async () => {
    if (isSearching || !query.trim() || !repoPath) return;

    setIsSearching(true);
    setHasSearched(true);
    setResults([]);

    const unlisten = await listen<SearchResult[]>("search-result", (event) => {
      setResults(prev => [...prev, ...event.payload]);
    });

    try {
      await invoke("search_workspace", {
        path: repoPath,
        query,
        isCaseSensitive,
        isRegex
      });
    } catch (e) {
      console.error("Search failed:", e);
    } finally {
      setIsSearching(false);
      unlisten();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const grouped = useMemo(() => {
    const groups: Record<string, { name: string, dir: string, matches: SearchResult[] }> = {};
    for (const r of results) {
      if (!groups[r.file_path]) {
        const parts = r.file_path.split("/");
        groups[r.file_path] = {
          name: parts.pop() || r.file_path,
          dir: parts.join("/"),
          matches: [],
        };
      }
      groups[r.file_path].matches.push(r);
    }
    return groups;
  }, [results]);

  const openFile = (file_path: string, line: number) => {
    if (!repoPath) return;
    const fullPath = `${repoPath}/${file_path}`;
    const name = file_path.split("/").pop() || file_path;
    EventBus.emit("app:open-tab", { id: fullPath, type: "file", title: name, path: fullPath });

    // Slight delay to allow the editor to mount if it wasn't open
    setTimeout(() => {
      // In Phase 3, we will add jumping to line logic. For now it just opens the file.
      // But we can trigger a cursor move event via EventBus if needed.
    }, 100);
  };

  const fileKeys = Object.keys(grouped);

  return (
    <div className="flex flex-col h-full w-full select-none bg-transparent">
      <div className="flex items-center justify-between px-[var(--PanelPaddingX)] pt-4 pb-2 shrink-0">
        <h2 className="text-[14px] font-bold text-[var(--ColorTextHighlight)] tracking-tight flex items-center gap-2">
          全局搜索
        </h2>
      </div>

      <div className="px-[var(--PanelPaddingX)] pb-4 shrink-0 mt-2 flex flex-col gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-[11.5px] text-[var(--ColorMuted)]">
          <Icons.Info size={14} className="opacity-60 shrink-0" />
          <span className="opacity-80">全局搜索即将被 Fliuno 搜索替代</span>
        </div>

        <div className="flex flex-col p-3 rounded-2xl bg-white/5 dark:bg-white/10 backdrop-blur-md border border-black/5 dark:border-white/5 shadow-inner gap-3 transition-all">
          <input
            type="text"
            className="w-full bg-transparent text-[13px] text-[var(--ColorTextHighlight)] outline-none placeholder-[var(--ColorMuted)] leading-relaxed"
            placeholder="全局搜索... (回车以执行)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Tooltip content="区分大小写">
                <button
                  onClick={() => setIsCaseSensitive(!isCaseSensitive)}
                  className={`p-1.5 rounded-lg transition-colors ${isCaseSensitive ? 'bg-[var(--ColorAccent)] text-white shadow-sm' : 'text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/10 dark:hover:bg-white/20'}`}
                >
                  <Icons.Typography size={14} stroke={isCaseSensitive ? 2.5 : 2} />
                </button>
              </Tooltip>
              <Tooltip content="正则表达式">
                <button
                  onClick={() => setIsRegex(!isRegex)}
                  className={`p-1.5 rounded-lg transition-colors ${isRegex ? 'bg-[var(--ColorAccent)] text-white shadow-sm' : 'text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/10 dark:hover:bg-white/20'}`}
                >
                  <Icons.Asterisk size={14} stroke={isRegex ? 2.5 : 2} />
                </button>
              </Tooltip>
            </div>
            <Tooltip content="执行搜索">
              <button
                onClick={handleSearch}
                disabled={isSearching || !query.trim()}
                className="px-3 py-1.5 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 border border-[var(--ColorPanelBorder)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--ColorTextHighlight)] text-[12px] font-medium rounded-lg transition-all flex items-center gap-1.5"
              >
                <Icons.Search size={13} stroke={2} />
                搜索
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto aurona-scroll flex flex-col relative">
        {isSearching && results.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--ColorMuted)] text-[12px] gap-2">
            <Icons.Refresh size={14} className="animate-spin" />
            搜索中...
          </div>
        ) : !repoPath ? (
          <div className="p-4 text-center text-[12px] text-[var(--ColorMuted)] mt-4">
            未打开任何工作区
          </div>
        ) : hasSearched && results.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-[var(--ColorMuted)] mt-4">
            没有找到匹配项
          </div>
        ) : hasSearched ? (
          <div className="flex flex-col gap-0.5 py-2">
            <div className="px-[var(--PanelPaddingX)] mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--ColorMuted)] uppercase tracking-widest">
                找到 {results.length} 个结果 (在 {fileKeys.length} 个文件中)
              </span>
              {isSearching && (
                <Icons.Refresh size={12} className="animate-spin text-[var(--ColorMuted)]" />
              )}
            </div>
            {fileKeys.map(file => (
              <div key={file} className="flex flex-col mb-4 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-2xl overflow-hidden mx-[calc(var(--PanelPaddingX)-8px)] shadow-sm">
                <div className="flex items-center gap-2 px-3 py-2.5 bg-black/5 dark:bg-white/5 border-b border-black/5 dark:border-white/5 text-[12px] font-bold text-[var(--ColorTextHighlight)] group">
                  <Icons.FileCode size={16} className="text-blue-500 shrink-0" stroke={2} />
                  <span className="truncate">{grouped[file].name}</span>
                  <span className="truncate text-[10px] text-[var(--ColorMuted)] opacity-60 group-hover:opacity-100 transition-opacity ml-1 font-normal">
                    {grouped[file].dir}
                  </span>
                  <span className="ml-auto text-[10px] bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded-full text-[var(--ColorMuted)]">
                    {grouped[file].matches.length}
                  </span>
                </div>
                <div className="flex flex-col py-1.5">
                  {grouped[file].matches.map(match => (
                    <div
                      key={match.index}
                      onClick={() => openFile(file, match.line_number)}
                      className="flex items-start gap-3 px-3 py-1.5 hover:bg-[var(--ColorAccent)] hover:text-white cursor-pointer group transition-all text-[12px] relative"
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-transparent group-hover:bg-white transition-colors" />
                      <span className="text-[var(--ColorMuted)] group-hover:text-white/80 w-7 text-right shrink-0 select-none font-mono text-[11px] pt-[2px]">
                        {match.line_number}
                      </span>
                      <span className="truncate text-[var(--ColorText)] group-hover:text-white font-mono opacity-90 leading-relaxed">
                        {match.match_text.trim()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-center text-[12px] text-[var(--ColorMuted)] mt-4 opacity-50">
            <Icons.Search size={32} className="mx-auto mb-2 opacity-50" />
            输入内容并在全部文件中搜索
          </div>
        )}
      </div>
    </div>
  );
});
