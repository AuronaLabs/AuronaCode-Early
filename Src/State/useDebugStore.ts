import { create } from "zustand";
import type { DebugConfiguration } from "../Core/DebugConfigurationService";

export type DebugState = "idle" | "starting" | "running" | "paused" | "stopping" | "failed";
export type DebugDependencyState =
  | "unknown"
  | "checking"
  | "missing"
  | "installing"
  | "ready"
  | "failed";

export interface DebugBreakpoint {
  path: string;
  line: number;
  verified?: boolean;
  message?: string;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: { path?: string };
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  evaluateName?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
}

export interface DebugScope {
  name: string;
  variablesReference: number;
  expensive?: boolean;
}

interface DebugStore {
  state: DebugState;
  sessionId: string | null;
  sessionTargetPath: string | null;
  configurations: DebugConfiguration[];
  selectedConfiguration: string | null;
  threads: Array<{ id: number; name: string }>;
  stackFrames: DebugStackFrame[];
  selectedFrameId: number | null;
  scopes: DebugScope[];
  variablesByReference: Record<number, DebugVariable[]>;
  loadingVariableReferences: number[];
  breakpoints: DebugBreakpoint[];
  error: string | null;
  dependencyState: DebugDependencyState;
  dependencyMessage: string | null;
  pythonPath: string | null;
  set(patch: Partial<DebugStore>): void;
  toggleBreakpoint(path: string, line: number): void;
  reset(): void;
}

const initial = {
  state: "idle" as DebugState,
  sessionId: null,
  sessionTargetPath: null,
  configurations: [] as DebugConfiguration[],
  selectedConfiguration: null,
  threads: [],
  stackFrames: [],
  selectedFrameId: null,
  scopes: [],
  variablesByReference: {},
  loadingVariableReferences: [],
  breakpoints: [],
  error: null,
  dependencyState: "unknown" as DebugDependencyState,
  dependencyMessage: null,
  pythonPath: null,
};

export const useDebugStore = create<DebugStore>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  toggleBreakpoint: (path, line) =>
    set((state) => ({
      breakpoints: state.breakpoints.some((item) => item.path === path && item.line === line)
        ? state.breakpoints.filter((item) => item.path !== path || item.line !== line)
        : [...state.breakpoints, { path, line }],
    })),
  reset: () => set(initial),
}));
