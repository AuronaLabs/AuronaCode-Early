let draggedPath: string | null = null;

export const ExplorerDragSession = {
  begin(path: string) {
    draggedPath = path;
  },
  read(dataTransfer?: DataTransfer | null) {
    return (
      dataTransfer?.getData("application/x-aurona-file-node") ||
      dataTransfer?.getData("text/plain") ||
      draggedPath
    );
  },
  end() {
    draggedPath = null;
  },
};
