import { open, save } from "@tauri-apps/plugin-dialog";

export const desktopDialog = {
  async openFile(): Promise<string | null> {
    const selected = await open({ directory: false, multiple: false });
    return typeof selected === "string" ? selected : null;
  },

  async openFolder(): Promise<string | null> {
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  },

  saveFile: save,
};
