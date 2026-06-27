import { createContext, useContext } from "react";
import type { FileNode } from "../../Core/FileSystemService";
import type { InlineCreation } from "./FileExplorer";

export interface ExplorerContextValue {
  activePath: string | null;
  inlineCreation: InlineCreation | null;
  inlineEditing: string | null;
  onToggle: (node: FileNode) => void;
  onInlineCreate: (name: string) => void;
  onInlineCancel: () => void;
  onInlineRename: (oldPath: string, newName: string) => void;
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
}

export const ExplorerContext = createContext<ExplorerContextValue | null>(null);

export function useExplorerContext() {
  const ctx = useContext(ExplorerContext);
  if (!ctx) throw new Error("useExplorerContext must be used within ExplorerProvider");
  return ctx;
}
