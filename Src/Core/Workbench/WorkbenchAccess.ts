export interface WorkbenchNavigation {
  openFile(path: string): void;
  reveal(path: string, line: number): void;
}

let navigation: WorkbenchNavigation | null = null;

/** The application supplies navigation; domain services do not own UI state. */
export function registerWorkbenchNavigation(next: WorkbenchNavigation): () => void {
  navigation = next;
  return () => {
    if (navigation === next) navigation = null;
  };
}

export const WorkbenchAccess: WorkbenchNavigation = {
  openFile(path) {
    if (!navigation) throw new Error("Workbench navigation is not available");
    navigation.openFile(path);
  },
  reveal(path, line) {
    if (!navigation) throw new Error("Workbench navigation is not available");
    navigation.reveal(path, line);
  },
};
