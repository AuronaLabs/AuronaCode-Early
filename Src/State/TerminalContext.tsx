import { createContext, useContext, useEffect, useState } from "react";
import { EventBus } from "../Core/EventBus";
import { TerminalManager } from "../Core/TerminalService";
import type { TerminalInstance } from "../Foundation/Types/Terminal";
import type { ReactNode } from "react";

export interface TerminalContextValue {
  terminals: TerminalInstance[];
  activeTerminalId: string | null;
  isTerminalOpen: boolean;
  activeBottomTab: "problems" | "output" | "terminal";
  addTerminal: (shellPath?: string) => void;
  isTerminalListVisible: boolean;
  availableShells: import("../Foundation/Types/Terminal").ShellProfile[];
  isShellDropdownOpen: boolean;
  editingTerminalId: string | null;
  editingName: string;
  setIsTerminalOpen: (open: boolean) => void;
  setActiveBottomTab: (tab: "problems" | "output" | "terminal") => void;
  setIsTerminalListVisible: (visible: boolean) => void;
  setIsShellDropdownOpen: (open: boolean) => void;
  setEditingTerminalId: (id: string | null) => void;
  setEditingName: (name: string) => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [terminals, setTerminals] = useState(TerminalManager.getTerminals());
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpenState] = useState(false);
  const [activeBottomTab, setActiveBottomTab] = useState<"problems" | "output" | "terminal">("problems");
  const [isTerminalListVisible, setIsTerminalListVisible] = useState(false);
  const [availableShells, setAvailableShells] = useState<import("../Foundation/Types/Terminal").ShellProfile[]>([]);
  const [isShellDropdownOpen, setIsShellDropdownOpen] = useState(false);
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // 加载可用 Shell
  useEffect(() => {
    TerminalManager.getAvailableShells().then(setAvailableShells);
  }, []);

  // 终端实例管理
  useEffect(() => {
    const unsubList = EventBus.on("terminal:list-changed", (list) => {
      setTerminals([...list]);
      if (list.length === 0) TerminalManager.createTerminal();
    });
    const unsubActive = EventBus.on("terminal:active-changed", setActiveTerminalId);

    const initialList = TerminalManager.getTerminals();
    if (initialList.length === 0) {
      TerminalManager.createTerminal();
    } else {
      setTerminals(initialList);
      setActiveTerminalId(TerminalManager.getActiveTerminalId());
    }

    return () => {
      unsubList();
      unsubActive();
    };
  }, []);

  // 终端面板开关广播
  const setIsTerminalOpen = (open: boolean) => {
    setIsTerminalOpenState(open);
    EventBus.emit("app:terminal-state-changed", open);
  };

  // 监听外部触发的终端切换
  useEffect(() => {
    const unsub = EventBus.on("app:toggle-terminal", (force) => {
      setIsTerminalOpenState((prev) => (force !== undefined ? force : !prev));
    });
    return unsub;
  }, []);

  const value: TerminalContextValue = {
    terminals,
    activeTerminalId,
    isTerminalOpen,
    activeBottomTab,
    isTerminalListVisible,
    availableShells,
    isShellDropdownOpen,
    editingTerminalId,
    editingName,
    addTerminal: TerminalManager.createTerminal,
    setIsTerminalOpen,
    setActiveBottomTab,
    setIsTerminalListVisible,
    setIsShellDropdownOpen,
    setEditingTerminalId,
    setEditingName,
  };

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}

export function useTerminal(): TerminalContextValue {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminal must be used inside TerminalProvider");
  return ctx;
}
