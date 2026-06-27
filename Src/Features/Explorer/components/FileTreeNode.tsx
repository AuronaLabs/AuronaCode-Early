import React from "react";
import { Icons } from "../../../UI/Icons/IconManager";
import { InlineInput } from "./InlineInput";
import type { FileNode } from "../../../Core/FileSystemService";
import type { InlineCreation } from "../FileExplorer";
import { useExplorerContext } from "../ExplorerContext";

// 根据文件扩展名返回对应图标
function getFileIcon(filename: string, isActive: boolean) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const baseColor = isActive
    ? "text-[var(--ColorTextHighlight)]"
    : "text-[var(--ColorMuted)]";

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

export const FileTreeNode = React.memo(function FileTreeNode({
  node,
  depth,
}: FileTreeNodeProps) {
  const {
    activePath,
    inlineCreation,
    inlineEditing,
    onToggle,
    onInlineCreate,
    onInlineCancel,
    onInlineRename,
    onContextMenu,
  } = useExplorerContext();
  
  const isActive = activePath === node.path;
  const isTargetForInline =
    inlineCreation?.parentPath === node.path &&
    node.isDirectory &&
    node.isOpen;
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
            className="absolute top-0 bottom-0 border-l border-[var(--ColorPanelBorder)]/50 pointer-events-none"
            style={{ left: `calc(${index} * var(--TreeIndent) + 14px)` }}
          />
        ))}

      <div
        className={`group/tree flex items-center gap-1.5 py-[3px] mx-1 pr-2 rounded-md text-[13px] cursor-pointer select-none transition-colors ${
          isActive
            ? "bg-[var(--ColorAccent)]/15 text-[var(--ColorTextHighlight)] font-medium"
            : "text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10"
        }`}
        style={{ paddingLeft: `calc(${depth} * var(--TreeIndent) + 4px)` }}
        onClick={() => onToggle(node)}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node);
        }}
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {node.isDirectory ? (
            <div
              className={`transition-transform duration-150 ${node.isOpen ? "rotate-90" : "rotate-0"} ${
                isActive
                  ? "text-[var(--ColorAccent)]"
                  : "text-[var(--ColorMuted)] group-hover/tree:text-[var(--ColorTextHighlight)]"
              }`}
            >
              <Icons.ChevronRight size={14} stroke={2.5} />
            </div>
          ) : null}
        </div>

        <div className="shrink-0 flex items-center opacity-90 group-hover/tree:opacity-100 transition-opacity">
          {node.isDirectory ? (
            node.isOpen ? (
              <Icons.FolderOpen size={16} stroke={1.5} className="text-[var(--ColorAccent)]" />
            ) : (
              <Icons.Folder size={16} stroke={1.5} className="text-[var(--ColorAccent)]" />
            )
          ) : (
            getFileIcon(node.name, isActive)
          )}
        </div>

        <span className="truncate leading-tight select-none">{node.name}</span>
      </div>

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
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});
