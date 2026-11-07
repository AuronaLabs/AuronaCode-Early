import { create } from "zustand";
import { TerminalManager } from "../Core/TerminalService";
import { EventBus } from "../Foundation/EventBus";
import { Logger } from "../Foundation/Logger";
import type { ShellProfile, TerminalInstance } from "../Foundation/Types/Terminal";
import { useWorkbenchStore } from "./Workbench/useWorkbenchStore";

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
  addTerminal: (shellPath) => void TerminalManager.createTerminal(shellPath).catch(reportError),
  setIsTerminalListVisible: (visible) => set({ isTerminalListVisible: visible }),
  setIsShellDropdownOpen: (open) => set({ isShellDropdownOpen: open }),
  setEditingTerminalId: (id) => set({ editingTerminalId: id }),
  setEditingName: (name) => set({ editingName: name }),
}));

let terminalInitialization: Promise<void> | null = null;
let generation = 0;

function reportError(error: unknown): void {
  Logger.error("Unable to initialize terminal", error);
}

async function ensureTerminalReady(): Promise<void> {
  if (terminalInitialization) return terminalInitialization;
  const currentGeneration = generation;
  const request = (async () => {
    const shells = await TerminalManager.getAvailableShells();
    if (generation !== currentGeneration) return;
    useTerminalStore.setState({ availableShells: shells });
    await TerminalManager.ensureDefaultTerminal();
    if (generation !== currentGeneration) return;
    useTerminalStore.setState({
      terminals: [...TerminalManager.getTerminals()],
      activeTerminalId: TerminalManager.getActiveTerminalId(),
    });
  })();
  terminalInitialization = request;
  try {
    await request;
  } finally {
    if (terminalInitialization === request) terminalInitialization = null;
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
        void ensureTerminalReady().catch(reportError);
      }
    }),
    EventBus.on("app:open-terminal-at", (path) => {
      const currentGeneration = generation;
      useWorkbenchStore.getState().setActiveBottomPanel("terminal");
      useWorkbenchStore.getState().toggleBottomPanel(true);
      void ensureTerminalReady()
        .then(() => {
          if (generation === currentGeneration)
            return TerminalManager.createTerminal(undefined, path);
        })
        .catch(reportError);
    }),
  ];
  return () => {
    generation++;
    for (const unsubscribe of subscriptions) unsubscribe();
    TerminalManager.dispose();
    terminalInitialization = null;
    useTerminalStore.setState({
      terminals: [],
      activeTerminalId: null,
      availableShells: [],
      isShellDropdownOpen: false,
      isTerminalListVisible: false,
      editingTerminalId: null,
      editingName: "",
    });
  };
}
