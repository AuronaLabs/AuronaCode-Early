import { create } from "zustand";
import { TerminalManager } from "../Core/TerminalService";
import { EventBus } from "../Foundation/EventBus";
import type { ShellProfile, TerminalInstance } from "../Foundation/Types/Terminal";
import { useWorkbenchStore } from "./useWorkspaceStore";

export interface TerminalState {
  terminals: TerminalInstance[];
  activeTerminalId: string | null;
  isTerminalListVisible: boolean;
  availableShells: ShellProfile[];
  isShellDropdownOpen: boolean;
  editingTerminalId: string | null;
  editingName: string;
  addTerminal(shellPath?: string): void;
  setIsTerminalListVisible(visible: boolean): void;
  setIsShellDropdownOpen(open: boolean): void;
  setEditingTerminalId(id: string | null): void;
  setEditingName(name: string): void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  terminals: [],
  activeTerminalId: null,
  isTerminalListVisible: false,
  availableShells: [],
  isShellDropdownOpen: false,
  editingTerminalId: null,
  editingName: "",
  addTerminal: (shellPath) => void TerminalManager.createTerminal(shellPath),
  setIsTerminalListVisible: (visible) => set({ isTerminalListVisible: visible }),
  setIsShellDropdownOpen: (open) => set({ isShellDropdownOpen: open }),
  setEditingTerminalId: (id) => set({ editingTerminalId: id }),
  setEditingName: (name) => set({ editingName: name }),
}));

let terminalInitialization: Promise<void> | null = null;

async function ensureTerminalReady(): Promise<void> {
  if (terminalInitialization) return terminalInitialization;
  terminalInitialization = (async () => {
    const shells = await TerminalManager.getAvailableShells();
    useTerminalStore.setState({ availableShells: shells });
    const terminals = TerminalManager.getTerminals();
    if (terminals.length === 0) await TerminalManager.createTerminal();
    else {
      useTerminalStore.setState({
        terminals: [...terminals],
        activeTerminalId: TerminalManager.getActiveTerminalId(),
      });
    }
  })();
  try {
    await terminalInitialization;
  } catch (error) {
    terminalInitialization = null;
    throw error;
  }
}

export function initializeTerminalStore(): () => void {
  const subscriptions = [
    EventBus.on("terminal:list-changed", (list) => {
      useTerminalStore.setState({ terminals: [...list] });
    }),
    EventBus.on("terminal:active-changed", (id) => {
      useTerminalStore.setState({ activeTerminalId: id });
    }),
    EventBus.on("app:toggle-terminal", (force) => {
      const workbench = useWorkbenchStore.getState();
      const next = force ?? !workbench.isBottomPanelOpen;
      workbench.toggleBottomPanel(next);
      if (next) {
        workbench.setActiveBottomPanel("terminal");
        void ensureTerminalReady();
      }
    }),
    EventBus.on("app:open-terminal-at", (path) => {
      useWorkbenchStore.getState().setActiveBottomPanel("terminal");
      void ensureTerminalReady().then(() => TerminalManager.createTerminal(undefined, path));
    }),
  ];
  return () => {
    for (const unsubscribe of subscriptions) unsubscribe();
    TerminalManager.dispose();
    terminalInitialization = null;
    useTerminalStore.setState({
      terminals: [],
      activeTerminalId: null,
      availableShells: [],
      isShellDropdownOpen: false,
      isTerminalListVisible: false,
    });
  };
}
