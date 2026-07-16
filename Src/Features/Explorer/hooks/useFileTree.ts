import { open } from "@tauri-apps/plugin-dialog";
import { watch } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { type FileNode, FileSystemService } from "../../../Core/FileSystemService";
import { EventBus } from "../../../Foundation/EventBus";
import { WorkspaceStore } from "../../../Foundation/Storage/WorkspaceStore";
import { useWorkspaceStore } from "../../../State/useWorkspaceStore";
import { SIDEBAR_EXPLORER } from "../../../Shared/Constants/Sidebar";
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
  selectNode: (node: FileNode, openFile?: boolean) => void;
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
  handleDrop: (sourcePath: string, targetPath: string, copy?: boolean) => Promise<void>;
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
  const rootNodeRef = useRef<FileNode | null>(null);

  useEffect(() => {
    rootNodeRef.current = rootNode;
  }, [rootNode]);

  const hasDirtyOpenTabAtOrBelow = useCallback((path: string) => {
    return useWorkspaceStore
      .getState()
      .tabs.some((tab) => tab.isDirty && tab.path && (tab.path === path || isDescendant(tab.path, path)));
  }, []);

  const updateActivePathAfterMove = useCallback((oldPath: string, newPath: string) => {
    setActivePath((currentPath) => {
      if (currentPath === oldPath) return newPath;
      if (currentPath && isDescendant(currentPath, oldPath)) {
        return currentPath.replace(oldPath, newPath);
      }
      return currentPath;
    });
  }, []);

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
  }, []);

  const refreshOpenDirectories = useCallback(
    async (node: FileNode) => {
      const openPaths = Array.from(collectOpenPaths([node]));
      for (const openPath of openPaths) {
        await refreshDirectory(openPath);
      }
    },
    [refreshDirectory],
  );

  useEffect(() => {
    let unwatch: (() => void) | null = null;
    let timer: number | null = null;

    if (rootNode?.path) {
      watch(
        rootNode.path,
        () => {
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            const currentRoot = rootNodeRef.current;
            if (!currentRoot) return;
            refreshOpenDirectories(currentRoot).catch((error) => {
              console.warn("Failed to refresh watched directories:", error);
            });
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
  }, [refreshOpenDirectories, rootNode?.path]);

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

  const selectNode = useCallback(
    (node: FileNode, openFile = false) => {
      setActivePath(node.path);
      if (openFile && !node.isDirectory) onFileSelect(node.path);
    },
    [onFileSelect],
  );

  const toggleDir = useCallback(
    async (node: FileNode) => {
      selectNode(node, !node.isDirectory);
      if (!node.isDirectory) {
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
    [onFileSelect, selectNode],
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

  const revealInExplorer = useCallback(
    async (targetPath: string) => {
      const root = rootNodeRef.current;
      if (!root) {
        return;
      }

      const normalizedRoot = root.path.replace(/\\/g, "/").replace(/\/+$/, "");
      const normalizedTarget = targetPath.replace(/\\/g, "/");
      if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}/`)) {
        return;
      }

      useWorkspaceStore.getState().setActiveSidebar(SIDEBAR_EXPLORER);
      const relativePath = normalizedTarget.slice(normalizedRoot.length).replace(/^\/+/, "");
      const parentSegments = relativePath.split("/").filter(Boolean).slice(0, -1);

      let currentPath = root.path;
      await refreshDirectory(currentPath);
      for (const segment of parentSegments) {
        currentPath = FileSystemService.joinPath(currentPath, segment);
        await refreshDirectory(currentPath);
      }

      setActivePath(targetPath);
    },
    [refreshDirectory],
  );

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

  const startInlineCreate = useCallback(
    (type: "file" | "folder") => {
      const parentPath = getTargetParentPath();
      if (!parentPath) return;
      startInlineCreateAt(type, parentPath);
    },
    [getTargetParentPath, startInlineCreateAt],
  );

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
      if (hasDirtyOpenTabAtOrBelow(oldPath)) {
        showToast("请先保存已打开文件的更改，再重命名", "warning");
        return;
      }
      try {
        const parentPath = FileSystemService.dirname(oldPath);
        const newPath = await FileSystemService.renameEntry(oldPath, newName);
        await refreshDirectory(parentPath);
        EventBus.emit("file:renamed", { oldPath, newPath });
        updateActivePathAfterMove(oldPath, newPath);
        showToast("重命名完成", "success");
      } catch (error) {
        showToast(`重命名失败：${FileSystemService.toMessage(error)}`, "error");
      } finally {
        setInlineEditing(null);
      }
    },
    [hasDirtyOpenTabAtOrBelow, refreshDirectory, updateActivePathAfterMove],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deletePrompt) return;
    const node = deletePrompt;
    if (hasDirtyOpenTabAtOrBelow(node.path)) {
      showToast("请先保存已打开文件的更改，再删除", "warning");
      return;
    }
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
  }, [activePath, deletePrompt, hasDirtyOpenTabAtOrBelow, refreshDirectory]);

  const handlePaste = useCallback(
    async (targetDir: string) => {
      if (!clipboard) return;
      if (clipboard.isCut && hasDirtyOpenTabAtOrBelow(clipboard.path)) {
        showToast("请先保存已打开文件的更改，再移动", "warning");
        return;
      }
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
          EventBus.emit("file:renamed", { oldPath: clipboard.path, newPath: destPath });
          updateActivePathAfterMove(clipboard.path, destPath);
          setClipboard(null);
        }
        await refreshDirectory(targetDir);

        showToast(clipboard.isCut ? "移动成功" : "复制成功", "success");
      } catch (error) {
        showToast(`粘贴失败: ${FileSystemService.toMessage(error)}`, "error");
      }
    },
    [clipboard, hasDirtyOpenTabAtOrBelow, refreshDirectory, updateActivePathAfterMove],
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
    async (sourcePath: string, targetPath: string, copy = false) => {
      if (sourcePath === targetPath) return;

      if (!copy && hasDirtyOpenTabAtOrBelow(sourcePath)) {
        showToast("请先保存已打开文件的更改，再移动", "warning");
        return;
      }

      if (targetPath.startsWith(`${sourcePath}/`) || targetPath.startsWith(`${sourcePath}\\`)) {
        showToast("无法将文件夹移动到其子文件夹中", "error");
        return;
      }

      try {
        const fileName = FileSystemService.basename(sourcePath);
        const destPath = FileSystemService.joinPath(targetPath, fileName);
        if (sourcePath === destPath) return;

        await FileSystemService.copyOrMove(sourcePath, destPath, !copy);

        const oldParent = FileSystemService.dirname(sourcePath);
        if (copy) {
          await refreshDirectory(targetPath);
        } else {
          await refreshDirectory(oldParent);
          await refreshDirectory(targetPath);
          EventBus.emit("file:renamed", { oldPath: sourcePath, newPath: destPath });
          updateActivePathAfterMove(sourcePath, destPath);
        }

        showToast(copy ? "复制成功" : "移动成功", "success");
      } catch (error) {
        showToast(`移动失败: ${FileSystemService.toMessage(error)}`, "error");
      }
    },
    [hasDirtyOpenTabAtOrBelow, refreshDirectory, updateActivePathAfterMove],
  );

  useEffect(() => {
    const unsubOpenFolder = EventBus.on("app:open-folder", handleOpenFolder);
    const unsubNewFile = EventBus.on("app:create-file-prompt", () => startInlineCreate("file"));
    const unsubNewFolder = EventBus.on("app:create-folder-prompt", () =>
      startInlineCreate("folder"),
    );
    const unsubReveal = EventBus.on("app:reveal-in-explorer", (path: string) => {
      void revealInExplorer(path).catch((error) => {
        showToast(`Unable to reveal file: ${FileSystemService.toMessage(error)}`, "error");
      });
    });
    return () => {
      unsubOpenFolder();
      unsubNewFile();
      unsubNewFolder();
      unsubReveal();
    };
  }, [handleOpenFolder, revealInExplorer, startInlineCreate]);

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
    selectNode,
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
