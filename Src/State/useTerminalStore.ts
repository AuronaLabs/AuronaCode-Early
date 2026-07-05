import { create } from "zustand";
import { TerminalManager } from "../Core/TerminalService";
import { EventBus } from "../Foundation/EventBus";
import type { ShellProfile, TerminalInstance } from "../Foundation/Types/Terminal";

export interface TerminalState {
  terminals: TerminalInstance[];
  activeTerminalId: string | null;
  isTerminalOpen: boolean;
  activeBottomTab: "problems" | "output" | "terminal";
  isTerminalListVisible: boolean;
  availableShells: ShellProfile[];
  isShellDropdownOpen: boolean;
  editingTerminalId: string | null;
  editingName: string;

  addTerminal: (shellPath?: string) => void;
  setIsTerminalOpen: (open: boolean) => void;
  setActiveBottomTab: (tab: "problems" | "output" | "terminal") => void;
  setIsTerminalListVisible: (visible: boolean) => void;
  setIsShellDropdownOpen: (open: boolean) => void;
  setEditingTerminalId: (id: string | null) => void;
  setEditingName: (name: string) => void;
  _setTerminals: (terminals: TerminalInstance[]) => void;
  _setActiveTerminalId: (id: string | null) => void;
  _setAvailableShells: (shells: ShellProfile[]) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  terminals: [],
  activeTerminalId: null,
  isTerminalOpen: false,
  activeBottomTab: "problems",
  isTerminalListVisible: false,
  availableShells: [],
  isShellDropdownOpen: false,
  editingTerminalId: null,
  editingName: "",

  addTerminal: (shellPath) => TerminalManager.createTerminal(shellPath),
  
  setIsTerminalOpen: (open) => {
    set({ isTerminalOpen: open });
    EventBus.emit("app:terminal-state-changed", open);
  },
  
  setActiveBottomTab: (tab) => set({ activeBottomTab: tab }),
  setIsTerminalListVisible: (visible) => set({ isTerminalListVisible: visible }),
  setIsShellDropdownOpen: (open) => set({ isShellDropdownOpen: open }),
  setEditingTerminalId: (id) => set({ editingTerminalId: id }),
  setEditingName: (name) => set({ editingName: name }),
  _setTerminals: (terminals) => set({ terminals }),
  _setActiveTerminalId: (id) => set({ activeTerminalId: id }),
  _setAvailableShells: (shells) => set({ availableShells: shells }),
}));


TerminalManager.getAvailableShells().then((shells) => {
  useTerminalStore.getState()._setAvailableShells(shells);
});

const initialList = TerminalManager.getTerminals();
if (initialList.length === 0) {
  TerminalManager.createTerminal();
} else {
  useTerminalStore.getState()._setTerminals(initialList);
  useTerminalStore.getState()._setActiveTerminalId(TerminalManager.getActiveTerminalId());
}


EventBus.on("terminal:list-changed", (list: TerminalInstance[]) => {
  useTerminalStore.getState()._setTerminals([...list]);
  if (list.length === 0) TerminalManager.createTerminal();
});

EventBus.on("terminal:active-changed", (id: string | null) => {
  useTerminalStore.getState()._setActiveTerminalId(id);
});

EventBus.on("app:toggle-terminal", (force?: boolean) => {
  const store = useTerminalStore.getState();
  const newState = force !== undefined ? force : !store.isTerminalOpen;
  store.setIsTerminalOpen(newState);
});

EventBus.on("app:open-terminal-at", (path: string) => {
  TerminalManager.createTerminal(undefined, path);
  const store = useTerminalStore.getState();
  store.setActiveBottomTab("terminal");
  store.setIsTerminalOpen(true);
});
