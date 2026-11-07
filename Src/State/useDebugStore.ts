import { useStore } from "zustand";
import { DebugSessionStore, type DebugStore } from "../Core/Debug/DebugSessionStore";

export type {
  DebugBreakpoint,
  DebugDependencyState,
  DebugScope,
  DebugStackFrame,
  DebugState,
  DebugVariable,
  DebugWatchExpression,
} from "../Core/Debug/DebugSessionStore";

export const useDebugStore = Object.assign(
  <T = DebugStore>(selector: (state: DebugStore) => T = (state) => state as unknown as T) =>
    useStore(DebugSessionStore, selector),
  DebugSessionStore,
);
