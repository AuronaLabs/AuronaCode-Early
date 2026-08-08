import React, { useMemo, useRef, useState } from "react";
import { FileSystemService } from "../../Core/FileSystemService";
import { useLocale } from "../../Foundation/I18n";
import { Button } from "../../UI/Components/Button";

import { Modal } from "../../UI/Components/Modal";
import { showToast } from "../../UI/Feedback/Toast";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";
import { FileTreeNode } from "./components/FileTreeNode";
import { InlineInput } from "./components/InlineInput";
import { ExplorerContext } from "./ExplorerContext";
import { ExplorerDragSession } from "./ExplorerDragSession";
import { useFileTree } from "./hooks/useFileTree";
export type InlineCreation = {
  type: "file" | "folder";
  parentPath: string;
};

export const FileExplorer = React.memo(function FileExplorer({
  onFileSelect,
}: {
  onFileSelect: (path: string) => void;
}) {
  const { t } = useLocale();
  const treeRef = useRef<HTMLDivElement>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const {
    rootNode,
    activePath,
    inlineCreation,
    inlineEditing,
    deletePrompt,
    setDeletePrompt,
    setInlineEditing,
    handleOpenFolder,
    selectNode,
    refreshDirectory,
    startInlineCreate,
    handleInlineCreate,
    handleInlineCancel,
    handleInlineRename,
    handleConfirmDelete,
    clipboard,
    setClipboard,
    handlePaste,
    collapseAll,
    startInlineCreateAt,
    handleDuplicate,
    handleDrop,
    toggleDir,
  } = useFileTree(onFileSelect);

  const isRootTargetForInline = inlineCreation?.parentPath === rootNode?.path;
  const title = useMemo(() => rootNode?.name || t("explorer.title"), [rootNode, t]);
  const visibleNodes = useMemo(() => {
    const nodes: { node: NonNullable<typeof rootNode>; depth: number }[] = [];
    const visit = (children: NonNullable<typeof rootNode>["children"], depth: number) => {
      for (const node of children || []) {
        nodes.push({ node, depth });
        if (node.isDirectory && node.isOpen) visit(node.children, depth + 1);
      }
    };
    visit(rootNode?.children, 0);
    return nodes;
  }, [rootNode]);

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!rootNode || visibleNodes.length === 0) return;
    const activeIndex = Math.max(
      0,
      visibleNodes.findIndex(({ node }) => node.path === activePath),
    );
    const active = visibleNodes[activeIndex]?.node;
    if (!active) return;

    const selectAt = (index: number) => {
      const next = visibleNodes[Math.max(0, Math.min(index, visibleNodes.length - 1))]?.node;
      if (next) selectNode(next);
    };

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectAt(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectAt(activeIndex - 1);
    } else if (event.key === "ArrowRight" && active.isDirectory) {
      event.preventDefault();
      if (!active.isOpen) void toggleDir(active);
      else if (active.children?.[0]) selectNode(active.children[0]);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (active.isDirectory && active.isOpen) void toggleDir(active);
      else {
        const parentPath = FileSystemService.dirname(active.path);
        const parent = visibleNodes.find(({ node }) => node.path === parentPath)?.node;
        if (parent) selectNode(parent);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      void toggleDir(active);
    } else if (event.key === "F2") {
      event.preventDefault();
      setInlineEditing(active.path);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      setDeletePrompt(active);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      setClipboard({ path: active.path, isCut: false });
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
      event.preventDefault();
      setClipboard({ path: active.path, isCut: true });
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      const destination = active.isDirectory ? active.path : FileSystemService.dirname(active.path);
      void handlePaste(destination);
    }
  };

  const contextValue = useMemo(
    () => ({
      activePath,
      inlineCreation,
      inlineEditing,
      onToggle: toggleDir,
      onInlineCreate: handleInlineCreate,
      onInlineCancel: handleInlineCancel,
      onInlineRename: handleInlineRename,
      onDrop: handleDrop,
      startInlineCreateAt,
      setInlineEditing,
      setClipboard,
      clipboard,
      handlePaste,
      handleDuplicate,
      setDeletePrompt,
      rootPath: rootNode?.path || "",
      dropTargetPath,
      setDropTargetPath,
    }),
    [
      activePath,
      inlineCreation,
      inlineEditing,
      toggleDir,
      handleInlineCreate,
      handleInlineCancel,
      handleInlineRename,
      handleDrop,
      startInlineCreateAt,
      setInlineEditing,
      setClipboard,
      clipboard,
      handlePaste,
      handleDuplicate,
      setDeletePrompt,
      rootNode?.path,
      dropTargetPath,
    ],
  );

  React.useEffect(() => {
    if (!activePath || !treeRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(
        treeRef.current?.querySelectorAll<HTMLElement>("[data-file-path]") ?? [],
      ).find((element) => element.dataset.filePath === activePath);
      target?.scrollIntoView({ block: "nearest" });
      treeRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePath]);

  return (
    <ExplorerContext.Provider value={contextValue}>
      <div
        className="flex h-full w-full flex-col bg-transparent overflow-hidden outline-none"
        tabIndex={-1}
      >
        {}
        <SidebarPageHeader
          className="group"
          title={
            <Tooltip content={title} placement="bottom">
              <span className="mr-2 truncate select-none">{title}</span>
            </Tooltip>
          }
          actions={
            rootNode ? (
              <>
                <Tooltip content={t("explorer.newFile")} placement="bottom">
                  <button
                    type="button"
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] transition-colors"
                    onClick={() => startInlineCreate("file")}
                  >
                    <Icons.FilePlus size={16} />
                  </button>
                </Tooltip>
                <Tooltip content={t("explorer.newFolder")} placement="bottom">
                  <button
                    type="button"
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] transition-colors"
                    onClick={() => startInlineCreate("folder")}
                  >
                    <Icons.FolderPlus size={16} />
                  </button>
                </Tooltip>
                <div className="w-px h-3 bg-[var(--border-subtle)] mx-1" />
                <Tooltip content={t("explorer.collapseAll")} placement="bottom">
                  <button
                    type="button"
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] transition-colors"
                    onClick={collapseAll}
                  >
                    <Icons.Minus size={16} />
                  </button>
                </Tooltip>
                <Tooltip content={t("explorer.refresh")} placement="bottom">
                  <button
                    type="button"
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] transition-colors"
                    onClick={() =>
                      refreshDirectory(rootNode.path).catch((error) =>
                        showToast(
                          `${t("explorer.refreshFailed")}${FileSystemService.toMessage(error)}`,
                          "error",
                        ),
                      )
                    }
                  >
                    <Icons.Refresh size={16} />
                  </button>
                </Tooltip>
              </>
            ) : undefined
          }
        />

        {}
        {!rootNode ? (
          <div
            ref={treeRef}
            className="flex flex-1 flex-col items-center justify-center gap-4 px-4 outline-none"
            tabIndex={-1}
          >
            <p className="text-xs text-[var(--color-text-muted)] text-center select-none">
              {t("explorer.noFolderOpen")}
            </p>
            <Button onClick={handleOpenFolder} variant="primary">
              {t("explorer.openFolder")}
            </Button>
          </div>
        ) : (
          <div
            ref={treeRef}
            className="flex-1 overflow-y-auto overflow-x-hidden py-1 outline-none focus:outline-none relative"
            tabIndex={0}
            role="tree"
            aria-label={t("explorer.ariaLabel")}
            onKeyDown={handleTreeKeyDown}
            onClick={() => treeRef.current?.focus()}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? "copy" : "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const src = ExplorerDragSession.read(e.dataTransfer);
              if (src && rootNode) {
                void handleDrop(src, rootNode.path, e.ctrlKey || e.metaKey);
              }
              setDropTargetPath(null);
              ExplorerDragSession.end();
            }}
          >
            {isRootTargetForInline && inlineCreation && (
              <InlineInput
                type={inlineCreation.type}
                depth={0}
                onSubmit={handleInlineCreate}
                onCancel={handleInlineCancel}
              />
            )}

            {rootNode.children?.map((child) => (
              <FileTreeNode key={child.path} node={child} depth={0} />
            ))}

            {}
            <Modal
              isOpen={!!deletePrompt}
              onClose={() => setDeletePrompt(null)}
              title={t("explorer.deleteTitle")}
              icon={<Icons.AlertTriangle className="text-red-500" size={18} stroke={2} />}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setDeletePrompt(null)}>
                    {t("explorer.cancel")}
                  </Button>
                  <Button variant="danger" onClick={handleConfirmDelete}>
                    {t("explorer.deleteForever")}
                  </Button>
                </>
              }
            >
              {t("explorer.deleteConfirmStart")} <strong>{deletePrompt?.name}</strong>{" "}
              {t("explorer.deleteConfirmEnd")}
              <br />
              {t("explorer.deleteIrreversible")}
            </Modal>
          </div>
        )}
      </div>
    </ExplorerContext.Provider>
  );
});
