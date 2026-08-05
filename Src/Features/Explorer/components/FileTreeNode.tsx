import React, { useCallback } from "react";
import { type FileNode, FileSystemService } from "../../../Core/FileSystemService";
import { EventBus } from "../../../Foundation/EventBus";
import {
  ContextMenuContent,
  ContextMenuDivider,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "../../../UI/Components/ContextMenu";
import { Icons } from "../../../UI/Icons/IconManager";
import { useExplorerContext } from "../ExplorerContext";
import { ExplorerDragSession, FILE_NODE_MIME } from "../ExplorerDragSession";
import { InlineInput } from "./InlineInput";

// 文件类型品牌色集中在常量中，便于统一维护；界面语义色仍走 Material token。
const FILE_TYPE_COLORS: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#f7df1e",
  jsx: "#f7df1e",
  py: "#3776ab",
  css: "#264de4",
  html: "#e34f26",
  json: "#cb3837",
  png: "#a855f7",
  jpg: "#a855f7",
  jpeg: "#a855f7",
  svg: "#a855f7",
  gif: "#a855f7",
};

function getFileIcon(filename: string, isActive: boolean) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const baseColor = isActive
    ? "text-[var(--color-text-highlight)]"
    : "text-[var(--color-text-muted)]";
  const brandColor = ext ? FILE_TYPE_COLORS[ext] : undefined;
  const iconStyle = brandColor ? { color: brandColor } : undefined;

  switch (ext) {
    case "ts":
    case "tsx":
      return <Icons.FileTs size={16} stroke={1.5} style={iconStyle} />;
    case "js":
    case "jsx":
      return <Icons.FileJs size={16} stroke={1.5} style={iconStyle} />;
    case "py":
      return <Icons.FilePy size={16} stroke={1.5} style={iconStyle} />;
    case "css":
      return <Icons.FileCss size={16} stroke={1.5} style={iconStyle} />;
    case "html":
      return <Icons.FileHtml size={16} stroke={1.5} style={iconStyle} />;
    case "json":
      return <Icons.FileJson size={16} stroke={1.5} style={iconStyle} />;
    case "md":
      return <Icons.FileMd size={16} stroke={1.5} className={baseColor} />;
    case "png":
    case "jpg":
    case "jpeg":
    case "svg":
    case "gif":
      return <Icons.FileImage size={16} stroke={1.5} style={iconStyle} />;
    default:
      return <Icons.File size={16} stroke={1.5} className={baseColor} />;
  }
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
}

export const FileTreeNode = React.memo(function FileTreeNode({ node, depth }: FileTreeNodeProps) {
  const {
    activePath,
    inlineCreation,
    inlineEditing,
    onToggle,
    onInlineCreate,
    onInlineCancel,
    onInlineRename,
    onDrop,
    startInlineCreateAt,
    setInlineEditing,
    setClipboard,
    clipboard,
    handlePaste,
    handleDuplicate,
    setDeletePrompt,
    rootPath,
    dropTargetPath,
    setDropTargetPath,
  } = useExplorerContext();

  const [isDragHover, setIsDragHover] = React.useState(false);
  const autoExpandTimer = React.useRef<number | null>(null);
  const dragEnterDepth = React.useRef(0);
  const suppressClickUntil = React.useRef(0);

  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimer.current !== null) {
      window.clearTimeout(autoExpandTimer.current);
      autoExpandTimer.current = null;
    }
  }, []);

  const isActive = activePath === node.path;
  const isTargetForInline =
    inlineCreation?.parentPath === node.path && node.isDirectory && node.isOpen;
  const isEditingThis = inlineEditing === node.path;
  const isDropTarget = dropTargetPath === node.path;

  React.useEffect(() => clearAutoExpandTimer, [clearAutoExpandTimer]);

  if (isEditingThis) {
    return (
      <InlineInput
        type={node.isDirectory ? "folder" : "file"}
        depth={depth}
        initialValue={node.name}
        onSubmit={(newName) => onInlineRename(node.path, newName)}
        onCancel={onInlineCancel}
      />
    );
  }

  return (
    <div className="flex flex-col relative">
      {depth > 0 &&
        Array.from({ length: depth }, (_, index) => index + 1).map((guide) => (
          <div
            key={`${node.path}-guide-${guide}`}
            className="absolute top-0 bottom-0 border-l border-[var(--border-subtle)]/50 pointer-events-none"
            style={{ left: `calc(${guide - 1} * var(--TreeIndent) + 14px)` }}
          />
        ))}

      <ContextMenuRoot>
        <ContextMenuTrigger asChild>
          <div
            data-file-path={node.path}
            role="treeitem"
            tabIndex={-1}
            aria-selected={isActive}
            aria-expanded={node.isDirectory ? node.isOpen : undefined}
            draggable={true}
            className={`group/tree relative flex items-center gap-1.5 py-[3px] mx-1 pr-2 rounded-lg text-[13px] cursor-pointer select-none transition-colors outline-none ${
              isDragHover
                ? "bg-[var(--material-overlay)] border border-[var(--border-subtle)]"
                : isActive
                  ? "bg-[var(--material-surface)] text-[var(--color-text-highlight)] font-medium"
                  : "text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)]"
            }`}
            style={{
              paddingLeft: `calc(${depth} * var(--TreeIndent) + 4px)`,
            }}
            onClick={() => {
              if (Date.now() < suppressClickUntil.current) return;
              onToggle(node);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") onToggle(node);
            }}
            onDragStart={(e) => {
              e.stopPropagation();
              suppressClickUntil.current = Date.now() + 300;
              ExplorerDragSession.begin(node.path);
              e.dataTransfer.setData(FILE_NODE_MIME, node.path);
              e.dataTransfer.effectAllowed = "copyMove";
            }}
            onDragEnd={() => {
              ExplorerDragSession.end();
              setIsDragHover(false);
              dragEnterDepth.current = 0;
              setDropTargetPath(null);
              clearAutoExpandTimer();
            }}
            onDragOver={(e) => {
              if (node.isDirectory) {
                e.preventDefault();
                e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? "copy" : "move";
              }
            }}
            onDragEnter={(e) => {
              e.stopPropagation();
              dragEnterDepth.current += 1;
              setDropTargetPath(node.path);
              if (node.isDirectory) {
                e.preventDefault();
                setIsDragHover(true);
                if (!node.isOpen) {
                  clearAutoExpandTimer();
                  autoExpandTimer.current = window.setTimeout(() => onToggle(node), 700);
                }
              }
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              dragEnterDepth.current = Math.max(0, dragEnterDepth.current - 1);
              if (dragEnterDepth.current === 0) {
                setIsDragHover(false);
                if (dropTargetPath === node.path) setDropTargetPath(null);
                clearAutoExpandTimer();
              }
            }}
            onDrop={(e) => {
              if (!node.isDirectory) {
                // A file row is not a drop target on its own; let the event
                // bubble to the containing directory row (or the tree root)
                // so dropping onto a file still lands in its folder.
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              setIsDragHover(false);
              dragEnterDepth.current = 0;
              setDropTargetPath(null);
              clearAutoExpandTimer();
              const src = ExplorerDragSession.read(e.dataTransfer);
              if (src) {
                void onDrop(src, node.path, e.ctrlKey || e.metaKey);
              }
              ExplorerDragSession.end();
            }}
          >
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              {node.isDirectory ? (
                <div
                  className={`transition-transform duration-150 ${node.isOpen ? "rotate-90" : "rotate-0"} ${
                    isActive
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)] group-hover/tree:text-[var(--color-text-highlight)]"
                  }`}
                >
                  <Icons.ChevronRight size={14} stroke={2.5} />
                </div>
              ) : null}
            </div>

            <div className="shrink-0 flex items-center opacity-90 group-hover/tree:opacity-100 transition-opacity">
              {node.isDirectory ? (
                node.isOpen ? (
                  <Icons.FolderOpen size={16} stroke={1.5} className="text-[var(--color-accent)]" />
                ) : (
                  <Icons.Folder size={16} stroke={1.5} className="text-[var(--color-accent)]" />
                )
              ) : (
                getFileIcon(node.name, isActive)
              )}
            </div>

            <span className="truncate leading-tight select-none">{node.name}</span>
            {isDropTarget && (
              <span className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--color-accent)]" />
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem
            label="在此处新建文件"
            disabled={!node.isDirectory}
            onSelect={() => {
              if (node.isDirectory) {
                startInlineCreateAt("file", node.path);
              }
            }}
          />
          <ContextMenuItem
            label="在此处新建文件夹"
            disabled={!node.isDirectory}
            onSelect={() => {
              if (node.isDirectory) {
                startInlineCreateAt("folder", node.path);
              }
            }}
          />
          <ContextMenuDivider />
          <ContextMenuItem
            label="重命名"
            onSelect={() => {
              setInlineEditing(node.path);
            }}
          />
          <ContextMenuItem
            label="复制"
            onSelect={() => {
              setClipboard({ path: node.path, isCut: false });
            }}
          />
          <ContextMenuItem
            label="剪切"
            onSelect={() => {
              setClipboard({ path: node.path, isCut: true });
            }}
          />
          <ContextMenuItem
            label="粘贴"
            disabled={!clipboard || !node.isDirectory}
            onSelect={() => {
              if (clipboard && node.isDirectory) {
                handlePaste(node.path);
              }
            }}
          />
          <ContextMenuItem
            label="创建副本"
            onSelect={() => {
              handleDuplicate(node);
            }}
          />
          <ContextMenuDivider />
          <ContextMenuItem
            label="复制相对路径"
            onSelect={() => {
              const relativePath = node.path.replace(`${rootPath}/`, "");
              navigator.clipboard.writeText(relativePath);
            }}
          />
          <ContextMenuItem
            label="复制绝对路径"
            onSelect={() => {
              navigator.clipboard.writeText(node.path);
            }}
          />
          <ContextMenuItem
            label="在资源管理器中显示"
            onSelect={() => {
              FileSystemService.revealInOs(node.path);
            }}
          />
          <ContextMenuItem
            label="在集成终端中打开"
            disabled={!node.isDirectory}
            onSelect={() => {
              if (node.isDirectory) {
                EventBus.emit("app:open-terminal-at", node.path);
              }
            }}
          />
          <ContextMenuDivider />
          <ContextMenuItem
            label="删除"
            variant="danger"
            onSelect={() => {
              setDeletePrompt(node);
            }}
          />
        </ContextMenuContent>
      </ContextMenuRoot>

      {node.isDirectory && node.isOpen && (
        <div className="flex flex-col relative">
          {isTargetForInline && (
            <InlineInput
              type={inlineCreation?.type}
              depth={depth + 1}
              onSubmit={onInlineCreate}
              onCancel={onInlineCancel}
            />
          )}
          {node.children?.map((child) => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
});
