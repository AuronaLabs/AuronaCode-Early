import { open } from "@tauri-apps/plugin-dialog";
import { watch } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useState } from "react";
import { type FileNode, FileSystemService } from "../../../Core/FileSystemService";
import { EventBus } from "../../../Foundation/EventBus";
import { WorkspaceStore } from "../../../Foundation/Storage/WorkspaceStore";
import { showToast } from "../../../UI/Feedback/Toast";
import type { InlineCreation } from "../FileExplorer";
import { collectOpenPaths, isDescendant, mergeOpenState, updateTree } from "../utils/treeUtils";

export interface UseFileTreeReturn {
  rootNode: FileNode | null;
  activePath: string | null;
  inlineCreation: InlineCreation | null;
  inlineEditing: string | null;
  contextMenu: { x: number; y: number; node: FileNode } | null;
  deletePrompt: FileNode | null;
  setContextMenu: (menu: { x: number; y: number; node: FileNode } | null) => void;
  setDeletePrompt: (node: FileNode | null) => void;
  setInlineEditing: (path: string | null) => void;
  clipboard: { path: string; isCut: boolean } | null;
  setClipboard: (state: { path: string; isCut: boolean } | null) => void;
  handlePaste: (targetDir: string) => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  refreshDirectory: (dirPath: string) => Promise<void>;
  toggleDir: (node: FileNode) => Promise<void>;
  startInlineCreate: (type: "file" | "folder") => void;
  handleInlineCreate: (name: string) => Promise<void>;
  handleInlineCancel: () => void;
  handleInlineRename: (oldPath: string, newName: string) => Promise<void>;
  handleConfirmDelete: () => Promise<void>;
  handleContextMenu: (event: React.MouseEvent, node: FileNode) => void;
  collapseAll: () => void;
  startInlineCreateAt: (type: "file" | "folder", targetParentPath: string) => void;
  handleDuplicate: (node: FileNode) => Promise<void>;
  handleDrop: (sourcePath: string, targetPath: string) => Promise<void>;
}

export function useFileTree(onFileSelect: (path: string) => void): UseFileTreeReturn {
  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [inlineCreation, setInlineCreation] = useState<InlineCreation | null>(null);
  const [inlineEditing, setInlineEditing] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode;
  } | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<FileNode | null>(null);
  const [clipboard, setClipboard] = useState<{ path: string; isCut: boolean } | null>(null);

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
      WorkspaceStore.set({ lastOpenedPath: selectedPath });
      EventBus.emit("workspace:root-changed", selectedPath);
    } catch (error) {
      showToast(`打开文件夹失败：${FileSystemService.toMessage(error)}`, "error");
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await WorkspaceStore.init();
      const config = await WorkspaceStore.get();
      if (config.lastOpenedPath) {
        await loadFolderDirectly(config.lastOpenedPath);
      }
    };
    init();
  }, [loadFolderDirectly]);

  const refreshDirectory = useCallback(async (dirPath: string) => {
    try {
      const refreshedChildren = await FileSystemService.readDirectory(dirPath);
      setRootNode((prev) => {
        if (!prev) return prev;
        const openPaths = collectOpenPaths([prev]);
        if (prev.path === dirPath) {
          return {
            ...prev,
            children: mergeOpenState(refreshedChildren, prev.children || [], openPaths),
            isOpen: true,
          };
        }
        return {
          ...prev,
          children: updateTree(prev.children || [], dirPath, (node) => ({
            ...node,
            children: mergeOpenState(refreshedChildren, node.children || [], openPaths),
            isOpen: true,
          })),
        };
      });
    } catch {}
  }, []);

  useEffect(() => {
    let unwatch: (() => void) | null = null;
    let timer: number | null = null;

    if (rootNode?.path) {
      watch(
        rootNode.path,
        () => {
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            refreshDirectory(rootNode.path).catch(() => {});
          }, 300);
        },
        { recursive: true },
      )
        .then((fn) => {
          unwatch = fn;
        })
        .catch((err) => {
          console.error("FS Watcher failed:", err);
        });
    }

    return () => {
      if (timer) window.clearTimeout(timer);
      unwatch?.();
    };
  }, [rootNode?.path, refreshDirectory]);

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
        setRootNode((prev) => {
          if (!prev) return prev;
          if (prev.path === node.path) return { ...prev, isOpen: false };
          return {
            ...prev,
            children: updateTree(prev.children || [], node.path, (item) => ({
              ...item,
              isOpen: false,
            })),
          };
        });
        return;
      }
      try {
        const children = node.children ?? (await FileSystemService.readDirectory(node.path));
        setRootNode((prev) => {
          if (!prev) return prev;
          if (prev.path === node.path) return { ...prev, isOpen: true, children };
          return {
            ...prev,
            children: updateTree(prev.children || [], node.path, (item) => ({
              ...item,
              isOpen: true,
              children,
            })),
          };
        });
      } catch (error) {
        showToast(`读取目录失败：${FileSystemService.toMessage(error)}`, "error");
      }
    },
    [onFileSelect],
  );

  const collapseAll = useCallback(() => {
    setRootNode((prev) => {
      if (!prev) return prev;

      const closeAll = (nodes: FileNode[]): FileNode[] => {
        return nodes.map((n) => {
          if (!n.isDirectory) return n;
          return { ...n, isOpen: false, children: n.children ? closeAll(n.children) : undefined };
        });
      };
      return { ...prev, children: prev.children ? closeAll(prev.children) : undefined };
    });
  }, []);

  const findActiveDirectory = useCallback(
    (nodes: FileNode[], targetPath: string | null): FileNode | null => {
      if (!targetPath) return null;
      for (const node of nodes) {
        if (node.path === targetPath && node.isDirectory) return node;
        if (node.children && isDescendant(targetPath, node.path)) {
          const found = findActiveDirectory(node.children, targetPath);
          if (found) return found;
        }
      }
      return null;
    },
    [],
  );

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
      startInlineCreateAt(type, parentPath);
    },
    [getTargetParentPath],
  );

  const startInlineCreateAt = useCallback((type: "file" | "folder", parentPath: string) => {
    setInlineCreation({ type, parentPath });
    setRootNode((prev) => {
      if (!prev) return prev;
      if (prev.path === parentPath) return { ...prev, isOpen: true };
      return {
        ...prev,
        children: updateTree(prev.children || [], parentPath, (node) => ({
          ...node,
          isOpen: true,
        })),
      };
    });
  }, []);

  const handleInlineCreate = useCallback(
    async (name: string) => {
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
    },
    [inlineCreation, onFileSelect, refreshDirectory],
  );

  const handleInlineCancel = useCallback(() => {
    setInlineCreation(null);
    setInlineEditing(null);
  }, []);

  const handleInlineRename = useCallback(
    async (oldPath: string, newName: string) => {
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
    },
    [activePath, refreshDirectory],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deletePrompt) return;
    const node = deletePrompt;
    setDeletePrompt(null);
    try {
      const parentPath = FileSystemService.dirname(node.path);
      await FileSystemService.deleteEntry(node.path, node.isDirectory);
      await refreshDirectory(parentPath);
      EventBus.emit("file:deleted", { path: node.path, isDirectory: node.isDirectory });
      if (
        activePath === node.path ||
        (node.isDirectory && activePath && isDescendant(activePath, node.path))
      ) {
        setActivePath(null);
      }
      showToast("删除完成", "success");
    } catch (error) {
      showToast(`删除失败：${FileSystemService.toMessage(error)}`, "error");
    }
  }, [activePath, deletePrompt, refreshDirectory]);

  const handlePaste = useCallback(
    async (targetDir: string) => {
      if (!clipboard) return;
      try {
        const fileName = FileSystemService.basename(clipboard.path);
        const destPath = FileSystemService.joinPath(targetDir, fileName);

        if (clipboard.path === destPath) {
          showToast("不能粘贴到同一位置", "warning");
          return;
        }

        await FileSystemService.copyOrMove(clipboard.path, destPath, clipboard.isCut);

        if (clipboard.isCut) {
          const oldParent = FileSystemService.dirname(clipboard.path);
          await refreshDirectory(oldParent);
          setClipboard(null);
        }
        await refreshDirectory(targetDir);

        showToast(clipboard.isCut ? "移动成功" : "复制成功", "success");
      } catch (error) {
        showToast(`粘贴失败: ${FileSystemService.toMessage(error)}`, "error");
      }
    },
    [clipboard, refreshDirectory],
  );

  const handleDuplicate = useCallback(
    async (node: FileNode) => {
      try {
        const parentPath = FileSystemService.dirname(node.path);
        const fileName = FileSystemService.basename(node.path);

        let newFileName = "";
        if (node.isDirectory) {
          newFileName = `${fileName} - 副本`;
        } else {
          const lastDotIndex = fileName.lastIndexOf(".");
          if (lastDotIndex > 0) {
            const name = fileName.substring(0, lastDotIndex);
            const ext = fileName.substring(lastDotIndex);
            newFileName = `${name} - 副本${ext}`;
          } else {
            newFileName = `${fileName} - 副本`;
          }
        }

        const newPath = FileSystemService.joinPath(parentPath, newFileName);
        await FileSystemService.copyOrMove(node.path, newPath, false);
        await refreshDirectory(parentPath);
        showToast("副本创建成功", "success");
      } catch (error) {
        showToast(`创建副本失败: ${FileSystemService.toMessage(error)}`, "error");
      }
    },
    [refreshDirectory],
  );

  const handleContextMenu = useCallback((event: React.MouseEvent, node: FileNode) => {
    setContextMenu({ x: event.pageX, y: event.pageY, node });
  }, []);

  const handleDrop = useCallback(
    async (sourcePath: string, targetPath: string) => {
      if (sourcePath === targetPath) return;

      if (targetPath.startsWith(sourcePath + "/") || targetPath.startsWith(sourcePath + "\\")) {
        showToast("无法将文件夹移动到其子文件夹中", "error");
        return;
      }

      try {
        const fileName = FileSystemService.basename(sourcePath);
        const destPath = FileSystemService.joinPath(targetPath, fileName);
        if (sourcePath === destPath) return;

        await FileSystemService.copyOrMove(sourcePath, destPath, true);

        const oldParent = FileSystemService.dirname(sourcePath);
        await refreshDirectory(oldParent);
        await refreshDirectory(targetPath);

        showToast("移动成功", "success");
      } catch (error) {
        showToast(`移动失败: ${FileSystemService.toMessage(error)}`, "error");
      }
    },
    [refreshDirectory],
  );

  useEffect(() => {
    const unsubOpenFolder = EventBus.on("app:open-folder", handleOpenFolder);
    const unsubNewFile = EventBus.on("app:create-file-prompt", () => startInlineCreate("file"));
    const unsubNewFolder = EventBus.on("app:create-folder-prompt", () =>
      startInlineCreate("folder"),
    );
    return () => {
      unsubOpenFolder();
      unsubNewFile();
      unsubNewFolder();
    };
  }, [handleOpenFolder, startInlineCreate]);

  return {
    rootNode,
    activePath,
    inlineCreation,
    inlineEditing,
    contextMenu,
    deletePrompt,
    setContextMenu,
    setDeletePrompt,
    setInlineEditing,
    handleOpenFolder,
    refreshDirectory,
    toggleDir,
    startInlineCreate,
    handleInlineCreate,
    handleInlineCancel,
    handleInlineRename,
    handleConfirmDelete,
    handleContextMenu,
    clipboard,
    setClipboard,
    handlePaste,
    collapseAll,
    startInlineCreateAt,
    handleDuplicate,
    handleDrop,
  };
}
