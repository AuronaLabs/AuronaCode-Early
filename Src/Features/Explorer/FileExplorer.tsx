import React, { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../../UI/Components/Button";
import { Icons } from "../../UI/Icons/IconManager";
import { EventBus } from "../../Core/EventBus";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { StorageManager } from "../../Core/StorageManager";
import { Modal } from "../../UI/Components/Modal";
import { showToast } from "../../UI/Feedback/Toast";
import { FileNode, FileSystemService } from "../../Core/FileSystemService";

export type InlineCreation = {
  type: "file" | "folder";
  parentPath: string;
};

const updateTree = (
  nodes: FileNode[],
  targetPath: string,
  updater: (node: FileNode) => FileNode,
): FileNode[] => {
  return nodes.map((node) => {
    if (node.path === targetPath) return updater(node);
    if (node.children && isDescendant(targetPath, node.path)) {
      return { ...node, children: updateTree(node.children, targetPath, updater) };
    }
    return node;
  });
};

const isDescendant = (path: string, possibleParent: string) => {
  return path.startsWith(`${possibleParent}/`) || path.startsWith(`${possibleParent}\\`);
};

const collectOpenPaths = (nodes: FileNode[] = [], result = new Set<string>()) => {
  for (const node of nodes) {
    if (node.isDirectory && node.isOpen) result.add(node.path);
    if (node.children) collectOpenPaths(node.children, result);
  }
  return result;
};

const mergeOpenState = (nodes: FileNode[], openPaths: Set<string>): FileNode[] => {
  return nodes.map((node) => ({
    ...node,
    isOpen: openPaths.has(node.path),
    children: node.children ? mergeOpenState(node.children, openPaths) : node.children,
  }));
};

const getFileIcon = (filename: string, isActive: boolean) => {
  const ext = filename.split(".").pop()?.toLowerCase();
  const baseColor = isActive ? "text-[var(--ColorTextHighlight)]" : "text-[var(--ColorMuted)]";

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
};

const InlineInput = ({
  type,
  depth,
  initialValue = "",
  onSubmit,
  onCancel,
}: {
  type: "file" | "folder";
  depth: number;
  initialValue?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState(initialValue);
  const commit = () => {
    if (value.trim() && value !== initialValue) onSubmit(value);
    else onCancel();
  };

  return (
    <div className="flex flex-col relative">
      {depth > 0 &&
        Array.from({ length: depth }).map((_, index) => (
          <div
            key={index}
            className="absolute top-0 bottom-0 border-l border-[var(--ColorPanelBorder)]/60 pointer-events-none"
            style={{ left: `calc(${index} * var(--TreeIndent) + 14px)` }}
          />
        ))}
      <div
        className="flex items-center gap-1.5 py-1 px-1 rounded-md"
        style={{ paddingLeft: `calc(${depth} * var(--TreeIndent) + 4px)` }}
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0" />
        <div className="shrink-0 flex items-center">
          {type === "folder" ? (
            <Icons.Folder size={16} stroke={2} className="text-[var(--ColorAccent)]" />
          ) : (
            <Icons.File size={16} stroke={1.5} className="text-[var(--ColorTextHighlight)]" />
          )}
        </div>
        <input
          autoFocus
          className="flex-1 bg-transparent border-b border-[var(--ColorAccent)] outline-none text-[12.5px] text-[var(--ColorTextHighlight)] px-1 py-0 rounded-none min-w-0"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") onCancel();
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
};

const FileTreeNode = React.memo(
  ({
    node,
    depth,
    activePath,
    inlineCreation,
    inlineEditing,
    onToggle,
    onInlineCreate,
    onInlineCancel,
    onInlineRename,
    onContextMenu,
  }: {
    node: FileNode;
    depth: number;
    activePath: string | null;
    inlineCreation: InlineCreation | null;
    inlineEditing: string | null;
    onToggle: (node: FileNode) => void;
    onInlineCreate: (name: string) => void;
    onInlineCancel: () => void;
    onInlineRename: (oldPath: string, newName: string) => void;
    onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
  }) => {
    const isActive = activePath === node.path;
    const isTargetForInline = inlineCreation?.parentPath === node.path && node.isDirectory && node.isOpen;
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
          onContextMenu={(event) => {
            event.preventDefault();
            onContextMenu(event, node);
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
                type={inlineCreation.type}
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
                activePath={activePath}
                inlineCreation={inlineCreation}
                inlineEditing={inlineEditing}
                onToggle={onToggle}
                onInlineCreate={onInlineCreate}
                onInlineCancel={onInlineCancel}
                onInlineRename={onInlineRename}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);

export function FileExplorer({ onFileSelect }: { onFileSelect: (path: string) => void }) {
  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [inlineCreation, setInlineCreation] = useState<InlineCreation | null>(null);
  const [inlineEditing, setInlineEditing] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<FileNode | null>(null);

  const loadFolderDirectly = useCallback(async (selectedPath: string) => {
    try {
      const folderName = FileSystemService.basename(selectedPath);
      const children = await FileSystemService.readDirectory(selectedPath);
      setRootNode({
        name: folderName,
        path: selectedPath,
        isDirectory: true,
        isOpen: true,
        children,
      });
      await StorageManager.saveConfig({ lastOpenedPath: selectedPath });
      EventBus.emit("workspace:root-changed", selectedPath);
    } catch (error) {
      showToast(`打开文件夹失败：${FileSystemService.toMessage(error)}`, "error");
    }
  }, []);

  useEffect(() => {
    const initStorage = async () => {
      await StorageManager.init();
      const config = await StorageManager.getConfig();
      if (config.lastOpenedPath) {
        await loadFolderDirectly(config.lastOpenedPath);
      }
    };
    initStorage();
  }, [loadFolderDirectly]);

  const refreshDirectory = useCallback(async (dirPath: string) => {
    const refreshedChildren = await FileSystemService.readDirectory(dirPath);
    setRootNode((previous) => {
      if (!previous) return previous;
      const openPaths = collectOpenPaths([previous]);
      if (previous.path === dirPath) {
        return { ...previous, children: mergeOpenState(refreshedChildren, openPaths), isOpen: true };
      }
      return {
        ...previous,
        children: updateTree(previous.children || [], dirPath, (node) => ({
          ...node,
          children: mergeOpenState(refreshedChildren, openPaths),
          isOpen: true,
        })),
      };
    });
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selectedPath = await open({ directory: true, multiple: false });
      if (selectedPath && typeof selectedPath === "string") {
        await loadFolderDirectly(selectedPath);
      }
    } catch (error) {
      showToast(`打开文件夹失败：${FileSystemService.toMessage(error)}`, "error");
    }
  }, [loadFolderDirectly]);

  const toggleDir = useCallback(
    async (node: FileNode) => {
      if (!node.isDirectory) {
        setActivePath(node.path);
        onFileSelect(node.path);
        return;
      }

      if (node.isOpen) {
        setRootNode((previous) => {
          if (!previous) return previous;
          if (previous.path === node.path) return { ...previous, isOpen: false };
          return { ...previous, children: updateTree(previous.children || [], node.path, (item) => ({ ...item, isOpen: false })) };
        });
        return;
      }

      try {
        const children = node.children ?? (await FileSystemService.readDirectory(node.path));
        setRootNode((previous) => {
          if (!previous) return previous;
          if (previous.path === node.path) return { ...previous, isOpen: true, children };
          return {
            ...previous,
            children: updateTree(previous.children || [], node.path, (item) => ({ ...item, isOpen: true, children })),
          };
        });
      } catch (error) {
        showToast(`读取目录失败：${FileSystemService.toMessage(error)}`, "error");
      }
    },
    [onFileSelect],
  );

  const findActiveDirectory = useCallback((nodes: FileNode[], targetPath: string | null): FileNode | null => {
    if (!targetPath) return null;
    for (const node of nodes) {
      if (node.path === targetPath && node.isDirectory) return node;
      if (node.children && isDescendant(targetPath, node.path)) {
        const found = findActiveDirectory(node.children, targetPath);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const getTargetParentPath = useCallback(() => {
    if (!rootNode) return null;
    if (activePath) {
      const activeDir = findActiveDirectory([rootNode], activePath);
      if (activeDir) return activeDir.path;
      const parentPath = FileSystemService.dirname(activePath);
      if (parentPath && parentPath.length >= rootNode.path.length) return parentPath;
    }
    return rootNode.path;
  }, [activePath, findActiveDirectory, rootNode]);

  const startInlineCreate = useCallback(
    (type: "file" | "folder") => {
      const parentPath = getTargetParentPath();
      if (!parentPath) return;
      setInlineCreation({ type, parentPath });
      setRootNode((previous) => {
        if (!previous) return previous;
        if (previous.path === parentPath) return { ...previous, isOpen: true };
        return { ...previous, children: updateTree(previous.children || [], parentPath, (node) => ({ ...node, isOpen: true })) };
      });
    },
    [getTargetParentPath],
  );

  const handleInlineCreate = async (name: string) => {
    if (!inlineCreation) return;
    const { type, parentPath } = inlineCreation;

    try {
      const newPath =
        type === "folder"
          ? await FileSystemService.createFolder(parentPath, name)
          : await FileSystemService.createFile(parentPath, name);
      await refreshDirectory(parentPath);

      if (type === "file") {
        setActivePath(newPath);
        onFileSelect(newPath);
      }
      showToast(type === "file" ? "文件已创建" : "文件夹已创建", "success");
    } catch (error) {
      showToast(`创建失败：${FileSystemService.toMessage(error)}`, "error");
    } finally {
      setInlineCreation(null);
    }
  };

  const handleInlineCancel = () => {
    setInlineCreation(null);
    setInlineEditing(null);
  };

  const handleInlineRename = async (oldPath: string, newName: string) => {
    try {
      const parentPath = FileSystemService.dirname(oldPath);
      const newPath = await FileSystemService.renameEntry(oldPath, newName);
      await refreshDirectory(parentPath);
      EventBus.emit("file:renamed", { oldPath, newPath });
      if (activePath === oldPath) setActivePath(newPath);
      showToast("重命名完成", "success");
    } catch (error) {
      showToast(`重命名失败：${FileSystemService.toMessage(error)}`, "error");
    } finally {
      setInlineEditing(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletePrompt) return;
    const node = deletePrompt;
    setDeletePrompt(null);

    try {
      const parentPath = FileSystemService.dirname(node.path);
      await FileSystemService.deleteEntry(node.path, node.isDirectory);
      await refreshDirectory(parentPath);
      EventBus.emit("file:deleted", { path: node.path, isDirectory: node.isDirectory });
      if (activePath === node.path || (node.isDirectory && activePath && isDescendant(activePath, node.path))) {
        setActivePath(null);
      }
      showToast("删除完成", "success");
    } catch (error) {
      showToast(`删除失败：${FileSystemService.toMessage(error)}`, "error");
    }
  };

  useEffect(() => {
    const unsubOpenFolder = EventBus.on("app:open-folder", handleOpenFolder);
    const unsubNewFile = EventBus.on("app:create-file-prompt", () => startInlineCreate("file"));
    const unsubNewFolder = EventBus.on("app:create-folder-prompt", () => startInlineCreate("folder"));
    return () => {
      unsubOpenFolder();
      unsubNewFile();
      unsubNewFolder();
    };
  }, [handleOpenFolder, startInlineCreate]);

  const isRootTargetForInline = inlineCreation?.parentPath === rootNode?.path;
  const title = useMemo(() => rootNode?.name || "资源管理器", [rootNode]);

  return (
    <div className="flex h-full w-full flex-col bg-transparent overflow-hidden outline-none" tabIndex={-1}>
      <div className="flex items-center justify-between px-[var(--PanelPaddingX)] pt-4 pb-2 shrink-0 group">
        <h2 className="text-[14px] font-bold text-[var(--ColorTextHighlight)] tracking-tight truncate mr-2 select-none" title={title}>
          {title}
        </h2>
        {rootNode && (
          <div className="flex items-center gap-0.5 transition-opacity">
            <Tooltip content="新建文件">
              <button className="p-1.5 rounded-lg text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors" onClick={() => startInlineCreate("file")}>
                <Icons.FilePlus size={16} />
              </button>
            </Tooltip>
            <Tooltip content="新建文件夹">
              <button className="p-1.5 rounded-lg text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors" onClick={() => startInlineCreate("folder")}>
                <Icons.FolderPlus size={16} />
              </button>
            </Tooltip>
            <Tooltip content="刷新">
              <button
                className="p-1.5 rounded-lg text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                onClick={() => refreshDirectory(rootNode.path).catch((error) => showToast(`刷新失败：${FileSystemService.toMessage(error)}`, "error"))}
              >
                <Icons.Refresh size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {!rootNode ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 outline-none" tabIndex={-1}>
          <p className="text-xs text-[var(--ColorMuted)] text-center select-none">当前未打开任何文件夹</p>
          <Button onClick={handleOpenFolder} variant="primary">
            打开文件夹
          </Button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 outline-none focus:outline-none relative" tabIndex={-1} onClick={() => setContextMenu(null)}>
          {isRootTargetForInline && inlineCreation && (
            <InlineInput type={inlineCreation.type} depth={0} onSubmit={handleInlineCreate} onCancel={handleInlineCancel} />
          )}
          {rootNode.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={0}
              activePath={activePath}
              inlineCreation={inlineCreation}
              inlineEditing={inlineEditing}
              onToggle={toggleDir}
              onInlineCreate={handleInlineCreate}
              onInlineCancel={handleInlineCancel}
              onInlineRename={handleInlineRename}
              onContextMenu={(event, node) => setContextMenu({ x: event.pageX, y: event.pageY, node })}
            />
          ))}

          {contextMenu && (
            <div
              className="fixed bg-[var(--ColorEditor)] border border-[var(--ColorPanelBorder)] shadow-2xl rounded-xl p-1 z-50 flex flex-col min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
              style={{ top: Math.min(contextMenu.y, window.innerHeight - 110), left: Math.min(contextMenu.x, window.innerWidth - 170) }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                onClick={() => {
                  setInlineEditing(contextMenu.node.path);
                  setContextMenu(null);
                }}
              >
                重命名
              </button>
              <div className="h-px bg-[var(--ColorPanelBorder)] my-0.5 mx-1" />
              <button
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-red-500 hover:bg-red-500/10 transition-colors"
                onClick={() => {
                  setDeletePrompt(contextMenu.node);
                  setContextMenu(null);
                }}
              >
                删除
              </button>
            </div>
          )}

          <Modal
            isOpen={!!deletePrompt}
            onClose={() => setDeletePrompt(null)}
            title="确认删除"
            icon={<Icons.AlertTriangle className="text-red-500" size={18} stroke={2} />}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDeletePrompt(null)}>
                  取消
                </Button>
                <Button variant="danger" onClick={handleConfirmDelete}>
                  永久删除
                </Button>
              </>
            }
          >
            你确定要永久删除 <strong>{deletePrompt?.name}</strong> 吗？
            <br />
            这个操作无法撤销
          </Modal>
        </div>
      )}
    </div>
  );
}
