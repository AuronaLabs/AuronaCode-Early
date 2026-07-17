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
import { InlineInput } from "./InlineInput";

function getFileIcon(filename: string, isActive: boolean) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const baseColor = isActive ? "text-[var(--TextHighlight)]" : "text-[var(--TextMuted)]";

  switch (ext) {
    case "ts":
    case "tsx":
      return <Icons.FileTs size={16} stroke={1.5} className="text-[#3178c6]" />;
    case "js":
    case "jsx":
      return <Icons.FileJs size={16} stroke={1.5} className="text-[#f7df1e]" />;
    case "py":
      return <Icons.FilePy size={16} stroke={1.5} className="text-[#3776ab]" />;
    case "css":
      return <Icons.FileCss size={16} stroke={1.5} className="text-[#264de4]" />;
    case "html":
      return <Icons.FileHtml size={16} stroke={1.5} className="text-[#e34f26]" />;
    case "json":
      return <Icons.FileJson size={16} stroke={1.5} className="text-[#cb3837]" />;
    case "md":
      return <Icons.FileMd size={16} stroke={1.5} className={baseColor} />;
    case "png":
    case "jpg":
    case "jpeg":
    case "svg":
    case "gif":
      return <Icons.FileImage size={16} stroke={1.5} className="text-[#a855f7]" />;
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
  } = useExplorerContext();

  const [isDragHover, setIsDragHover] = React.useState(false);
  const autoExpandTimer = React.useRef<number | null>(null);
  const dragEnterDepth = React.useRef(0);

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
            className="absolute top-0 bottom-0 border-l border-[var(--GlassBorder)]/50 pointer-events-none"
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
            className={`group/tree flex items-center gap-1.5 py-[3px] mx-1 pr-2 rounded-lg text-[13px] cursor-pointer select-none transition-colors outline-none ${
              isDragHover
                ? "bg-[var(--GlassSurface-Floating)] border border-[var(--GlassBorder)] shadow-md"
                : isActive
                  ? "bg-[var(--GlassSurface-Elevated)] text-[var(--TextHighlight)] font-medium shadow-sm border border-[var(--GlassBorder)]"
                  : "text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)]"
            }`}
            style={{
              paddingLeft: `calc(${depth} * var(--TreeIndent) + 4px)`,
            }}
            onClick={() => onToggle(node)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onToggle(node);
            }}
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData("application/x-aurona-file-node", node.path);
              e.dataTransfer.setData("text/plain", node.path);
              e.dataTransfer.effectAllowed = "copyMove";
            }}
            onDragOver={(e) => {
              if (node.isDirectory) {
                e.preventDefault();
                e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? "copy" : "move";
              }
            }}
            onDragEnter={(e) => {
              if (node.isDirectory) {
                e.preventDefault();
                dragEnterDepth.current += 1;
                setIsDragHover(true);
                if (!node.isOpen) {
                  clearAutoExpandTimer();
                  autoExpandTimer.current = window.setTimeout(() => onToggle(node), 700);
                }
              }
            }}
            onDragLeave={(e) => {
              if (node.isDirectory) {
                e.preventDefault();
                dragEnterDepth.current = Math.max(0, dragEnterDepth.current - 1);
                if (dragEnterDepth.current === 0) {
                  setIsDragHover(false);
                  clearAutoExpandTimer();
                }
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragHover(false);
              dragEnterDepth.current = 0;
              clearAutoExpandTimer();
              if (node.isDirectory) {
                const src = e.dataTransfer.getData("application/x-aurona-file-node");
                if (src) {
                  onDrop(src, node.path, e.ctrlKey || e.metaKey);
                }
              }
            }}
          >
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              {node.isDirectory ? (
                <div
                  className={`transition-transform duration-150 ${node.isOpen ? "rotate-90" : "rotate-0"} ${
                    isActive
                      ? "text-[var(--AccentPrimary)]"
                      : "text-[var(--TextMuted)] group-hover/tree:text-[var(--TextHighlight)]"
                  }`}
                >
                  <Icons.ChevronRight size={14} stroke={2.5} />
                </div>
              ) : null}
            </div>

            <div className="shrink-0 flex items-center opacity-90 group-hover/tree:opacity-100 transition-opacity">
              {node.isDirectory ? (
                node.isOpen ? (
                  <Icons.FolderOpen
                    size={16}
                    stroke={1.5}
                    className="text-[var(--AccentPrimary)]"
                  />
                ) : (
                  <Icons.Folder size={16} stroke={1.5} className="text-[var(--AccentPrimary)]" />
                )
              ) : (
                getFileIcon(node.name, isActive)
              )}
            </div>

            <span className="truncate leading-tight select-none">{node.name}</span>
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
