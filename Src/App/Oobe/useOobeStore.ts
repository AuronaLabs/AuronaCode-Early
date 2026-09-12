import { create } from "zustand";

export type OobeMode = "first-run" | "rerun";

interface OobeState {
  /** null 表示引导未激活；first-run 由启动流程依据 user-config.json 判定，rerun 由高级设置触发 */
  mode: OobeMode | null;
  open: (mode: OobeMode) => void;
  close: () => void;
}

/** 欢迎引导覆盖层状态：首次运行自动打开，高级设置支持重游。 */
export const useOobeStore = create<OobeState>((set) => ({
  mode: null,
  open: (mode) => set({ mode }),
  close: () => set({ mode: null }),
}));
