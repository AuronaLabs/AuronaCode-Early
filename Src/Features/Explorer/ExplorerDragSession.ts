export const FILE_NODE_MIME = "application/x-aurona-file-node";

let draggedPath: string | null = null;

export const ExplorerDragSession = {
  begin(path: string) {
    draggedPath = path;
  },
  read(dataTransfer?: DataTransfer | null) {
    // Internal file moves are keyed on the internal MIME only. Never fall back
    // to text/plain: selected text from the editor or another application
    // would otherwise be misread as a file path and trigger an accidental
    // move. WebView2 may omit custom drag data on drop, so the active in-app
    // session remains the authoritative fallback for internal drags.
    return dataTransfer?.getData(FILE_NODE_MIME) || draggedPath;
  },
  end() {
    draggedPath = null;
  },
};
