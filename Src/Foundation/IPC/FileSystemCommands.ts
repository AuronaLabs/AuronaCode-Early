import { invokeDesktop } from "../Desktop";

export const FileSystemCommands = {
  revealInOs: (path: string) => invokeDesktop<void>("reveal_in_os", { path }),

  copyOrMove: (workspaceRoot: string, source: string, destination: string, isMove: boolean) =>
    invokeDesktop<void>("fs_copy_or_move", {
      workspaceRoot,
      source,
      destination,
      isMove,
    }),
};
