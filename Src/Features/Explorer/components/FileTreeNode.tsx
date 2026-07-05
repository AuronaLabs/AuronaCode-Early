import React from "react";
import { FileSystemService, type FileNode } from "../../../Core/FileSystemService";
import { EventBus } from "../../../Foundation/EventBus";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuDivider,
} from "../../../UI/Components/ContextMenu";
import { Icons } from "../../../UI/Icons/IconManager";
import { useExplorerContext } from "../ExplorerContext";
import type { InlineCreation } from "../FileExplorer";
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

  const isActive = activePath === node.path;
  const isTargetForInline =
    inlineCreation?.parentPath === node.path && node.isDirectory && node.isOpen;
  const isEditingThis = inlineEditing === node.path;

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
        Array.from({ length: depth }).map((_, index) => (
          <div
            key={index}
            className="absolute top-0 bottom-0 border-l border-[var(--GlassBorder)]/50 pointer-events-none"
            style={{ left: `calc(${index} * var(--TreeIndent) + 14px)` }}
          />
        ))}

      <ContextMenuRoot>
        <ContextMenuTrigger asChild>
          <div
            draggable={true}
            className={`group/tree flex items-center gap-1.5 py-[3px] mx-1 pr-2 rounded-md text-[13px] cursor-pointer select-none transition-colors outline-none ${
              isDragHover
                ? "bg-[var(--AccentPrimary)]/20 border border-[var(--AccentPrimary)]/50"
                : isActive
                  ? "bg-[var(--AccentPrimary)]/15 text-[var(--TextHighlight)] font-medium"
                  : "text-[var(--TextHighlight)] hover:bg-black/5 dark:hover:bg-white/10"
            }`}
            style={{
              paddingLeft: `calc(${depth} * var(--TreeIndent) + 4px)`,
            }}
            onClick={() => onToggle(node)}
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData("text/plain", node.path);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (node.isDirectory) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            }}
            onDragEnter={(e) => {
              if (node.isDirectory) {
                e.preventDefault();
                setIsDragHover(true);
              }
            }}
            onDragLeave={(e) => {
              if (node.isDirectory) {
                e.preventDefault();
                setIsDragHover(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragHover(false);
              if (node.isDirectory) {
                const src = e.dataTransfer.getData("text/plain");
                if (src) {
                  onDrop(src, node.path);
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
                  <Icons.FolderOpen size={16} stroke={1.5} className="text-[var(--AccentPrimary)]" />
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
              const relativePath = node.path.replace(rootPath + "/", "");
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
              type={inlineCreation!.type}
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
