import { useEffect, useMemo, useState } from "react";
import { DocumentService } from "../../../Core/DocumentService";
import { EventBus } from "../../../Foundation/EventBus";
import { fileUriToPath } from "../../../Shared/Utils/UriUtils";
import { glassVariants } from "../../../UI/Core/GlassManager/variants";
import { Icons } from "../../../UI/Icons/IconManager";

export interface PeekLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface PeekPanelProps {
  locations: PeekLocation[];
  /** 面板 top（引擎按 contentInsetTop + (可视行+1)*lineHeight 计算的完整 px） */
  top: number;
  /** 面板 left（引擎按 contentInsetX 计算） */
  left: number;
  onClose: () => void;
}

interface PeekRow {
  key: string;
  path: string;
  fileName: string;
  line: number;
  preview: string;
}

/** 目标行预览文本：已打开文档直接读，未打开异步拉取 */
function usePeekRows(locations: PeekLocation[]): PeekRow[] {
  const [remotePreviews, setRemotePreviews] = useState<Record<string, string>>({});

  const rows = useMemo(
    () =>
      locations.map((location, index) => {
        const path = fileUriToPath(location.uri) || location.uri;
        const line = location.range.start.line;
        const document = DocumentService.get(path);
        const preview =
          document?.content !== undefined
            ? (document.content.split("\n")[line] ?? "").trim()
            : (remotePreviews[`${path}:${line}`] ?? "");
        return {
          key: `${location.uri}:${line}:${index}`,
          path,
          fileName: path.split(/[\\/]/).pop() ?? path,
          line: line + 1,
          preview: preview.slice(0, 160),
        };
      }),
    [locations, remotePreviews],
  );

  // 未打开文档的行异步拉取一次预览
  useEffect(() => {
    const missing = rows.filter((row) => !row.preview);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const row of missing) {
        try {
          const document = await DocumentService.open(row.path);
          if (cancelled) return;
          const lineText = (document?.content ?? "").split("\n")[row.line - 1] ?? "";
          setRemotePreviews((prev) => ({
            ...prev,
            [`${row.path}:${row.line - 1}`]: lineText.trim().slice(0, 160),
          }));
        } catch {
          // 无法打开（跨工作区/大二进制等）——留空即可
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  return rows;
}

/** 编辑器内嵌 Peek 定义浮层（0.4.6 简化版）：内嵌浮窗列出定义位置，点击跳转。 */
export function PeekPanel({ locations, top, left, onClose }: PeekPanelProps) {
  const rows = usePeekRows(locations);

  // Esc 关闭 + 点击面板外部关闭
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return (
    <div
      className={`absolute z-40 w-[420px] max-w-[90%] rounded-overlay overflow-hidden shadow-[var(--shadow-overlay)] ${glassVariants({ layer: "overlay" })}`}
      style={{ top: `${top}px`, left: `${left}px` }}
      data-peek-panel
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-highlight)]">
          <Icons.Eye size={13} stroke={1.75} />
          {locations.length} 个定义
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] cursor-pointer"
          aria-label="关闭 Peek"
        >
          <Icons.Close size={13} stroke={1.75} />
        </button>
      </div>
      <div className="max-h-[220px] overflow-y-auto aurona-scroll py-1">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => {
              EventBus.emit("editor:reveal-location", { path: row.path, line: row.line });
              onClose();
            }}
            className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-[var(--material-interactive-hover)] cursor-pointer"
          >
            <span className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
              <Icons.FileCode size={11} stroke={1.75} />
              <span className="font-medium text-[var(--color-text-secondary)]">{row.fileName}</span>
              <span className="font-mono">:{row.line}</span>
            </span>
            {row.preview && (
              <span className="truncate font-mono text-[11.5px] text-[var(--color-text-primary)]">
                {row.preview}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
