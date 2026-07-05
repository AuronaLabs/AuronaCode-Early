import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import { FileSystemService } from "../../Core/FileSystemService";
import { EventBus } from "../../Foundation/EventBus";
import { Button } from "../../UI/Components/Button";

import { Modal } from "../../UI/Components/Modal";
import { showToast } from "../../UI/Feedback/Toast";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { FileTreeNode } from "./components/FileTreeNode";
import { InlineInput } from "./components/InlineInput";
import { ExplorerContext } from "./ExplorerContext";
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
  const {
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
    toggleDir,
  } = useFileTree(onFileSelect);

  const isRootTargetForInline = inlineCreation?.parentPath === rootNode?.path;
  const title = useMemo(() => rootNode?.name || "资源管理器", [rootNode]);

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
    ],
  );

  return (
    <ExplorerContext.Provider value={contextValue}>
      <div
        className="flex h-full w-full flex-col bg-transparent overflow-hidden outline-none"
        tabIndex={-1}
      >
        {}
        <div className="flex items-center justify-between px-[var(--PanelPaddingX)] pt-4 pb-2 shrink-0 group">
          <h2
            className="text-[14px] font-bold text-[var(--TextHighlight)] tracking-tight truncate mr-2 select-none"
            title={title}
          >
            {title}
          </h2>
          {rootNode && (
            <div className="flex items-center gap-0.5 transition-opacity">
              <Tooltip content="新建文件" placement="bottom">
                <button
                  className="p-1.5 rounded-lg text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  onClick={() => startInlineCreate("file")}
                >
                  <Icons.FilePlus size={16} />
                </button>
              </Tooltip>
              <Tooltip content="新建文件夹" placement="bottom">
                <button
                  className="p-1.5 rounded-lg text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  onClick={() => startInlineCreate("folder")}
                >
                  <Icons.FolderPlus size={16} />
                </button>
              </Tooltip>
              <div className="w-px h-3 bg-[var(--GlassBorder)] mx-1" />
              <Tooltip content="折叠全部" placement="bottom">
                <button
                  className="p-1.5 rounded-lg text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  onClick={collapseAll}
                >
                  <Icons.Minus size={16} />
                </button>
              </Tooltip>
              <Tooltip content="刷新" placement="bottom">
                <button
                  className="p-1.5 rounded-lg text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  onClick={() =>
                    refreshDirectory(rootNode.path).catch((error) =>
                      showToast(`刷新失败：${FileSystemService.toMessage(error)}`, "error"),
                    )
                  }
                >
                  <Icons.Refresh size={16} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {}
        {!rootNode ? (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-4 px-4 outline-none"
            tabIndex={-1}
          >
            <p className="text-xs text-[var(--TextMuted)] text-center select-none">
              当前未打开任何文件夹
            </p>
            <Button onClick={handleOpenFolder} variant="primary">
              打开文件夹
            </Button>
          </div>
        ) : (
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden py-1 outline-none focus:outline-none relative"
            tabIndex={-1}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const src = e.dataTransfer.getData("text/plain");
              if (src && rootNode) {
                handleDrop(src, rootNode.path);
              }
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
    </ExplorerContext.Provider>
  );
});
