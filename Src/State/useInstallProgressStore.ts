import { create } from "zustand";

export interface InstallProgressItem {
  id: string;
  stage: "preparing" | "downloading" | "extracting" | "completed" | "failed";
  progress: number; // 0 - 100
  message: string;
}

interface InstallProgressStore {
  tasks: Record<string, InstallProgressItem>;
  setProgress: (
    id: string,
    stage: InstallProgressItem["stage"],
    progress: number,
    message: string,
  ) => void;
  clearProgress: (id: string) => void;
}

export const useInstallProgressStore = create<InstallProgressStore>((set) => ({
  tasks: {},
  setProgress: (id, stage, progress, message) =>
    set((state) => ({
      tasks: {
        ...state.tasks,
        [id]: { id, stage, progress: Math.min(100, Math.max(0, progress)), message },
      },
    })),
  clearProgress: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.tasks;
      return { tasks: rest };
    }),
}));
