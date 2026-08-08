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
  enabled?: boolean;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
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

export interface DebugWatchExpression {
  id: string;
  expression: string;
  value?: string;
  error?: string;
}

interface DebugStore {
  state: DebugState;
  sessionId: string | null;
  sessionTargetPath: string | null;
  configurations: DebugConfiguration[];
  selectedConfiguration: string | null;
  threads: Array<{ id: number; name: string }>;
  selectedThreadId: number | null;
  stackFrames: DebugStackFrame[];
  selectedFrameId: number | null;
  scopes: DebugScope[];
  variablesByReference: Record<number, DebugVariable[]>;
  loadingVariableReferences: number[];
  variablePagination: Record<number, { nextStart: number; hasMore: boolean }>;
  breakpoints: DebugBreakpoint[];
  watchExpressions: DebugWatchExpression[];
  changedVariables: string[];
  error: string | null;
  dependencyState: DebugDependencyState;
  dependencyMessage: string | null;
  pythonPath: string | null;
  set(patch: Partial<DebugStore>): void;
  toggleBreakpoint(path: string, line: number): void;
  setBreakpointEnabled(path: string, line: number, enabled: boolean): void;
  removeAllBreakpoints(): void;
  setAllBreakpointsEnabled(enabled: boolean): void;
  reset(): void;
}

const initial = {
  state: "idle" as DebugState,
  sessionId: null,
  sessionTargetPath: null,
  configurations: [] as DebugConfiguration[],
  selectedConfiguration: null,
  threads: [],
  selectedThreadId: null,
  stackFrames: [],
  selectedFrameId: null,
  scopes: [],
  variablesByReference: {},
  loadingVariableReferences: [],
  variablePagination: {},
  breakpoints: [],
  watchExpressions: [],
  changedVariables: [],
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
  setBreakpointEnabled: (path, line, enabled) =>
    set((state) => ({
      breakpoints: state.breakpoints.map((item) =>
        item.path === path && item.line === line ? { ...item, enabled } : item,
      ),
    })),
  removeAllBreakpoints: () => set({ breakpoints: [] }),
  setAllBreakpointsEnabled: (enabled) =>
    set((state) => ({
      breakpoints: state.breakpoints.map((item) => ({ ...item, enabled })),
    })),
  reset: () => set(initial),
}));
