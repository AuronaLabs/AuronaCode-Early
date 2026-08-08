import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDebugStore } from "../State/useDebugStore";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("../Foundation/IPC/DebugAdapterCommands", () => ({
  DebugAdapterIPC: {
    request: mocks.request,
    start: vi.fn(),
    stop: vi.fn(),
    onEvent: vi.fn(),
    onOutput: vi.fn(),
  },
}));

vi.mock("./OutputService", () => ({
  OutputService: { append: vi.fn() },
}));

vi.mock("../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: { get: vi.fn(() => Promise.resolve({ debug: {} })) },
}));

vi.mock("./DebugConfigurationService", () => ({
  DebugConfigurationService: {},
}));

import { DebugService } from "./DebugService";

describe("DebugService paused frame data", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    useDebugStore.getState().reset();
    useDebugStore.getState().set({
      state: "paused",
      sessionId: "session-1",
      stackFrames: [
        { id: 7, name: "caller", line: 4, column: 1 },
        { id: 9, name: "main", line: 12, column: 1 },
      ],
    });
  });

  it("loads every scope for the selected stack frame", async () => {
    mocks.request.mockImplementation(
      (_sessionId: string, command: string, arguments_: { variablesReference?: number }) => {
        if (command === "scopes") {
          return Promise.resolve({
            scopes: [
              { name: "Locals", variablesReference: 11 },
              { name: "Globals", variablesReference: 12, expensive: true },
            ],
          });
        }
        if (command === "variables" && arguments_.variablesReference === 11) {
          return Promise.resolve({
            variables: [{ name: "value", value: "42", variablesReference: 0 }],
          });
        }
        if (command === "variables" && arguments_.variablesReference === 12) {
          return Promise.resolve({
            variables: [{ name: "items", value: "list(2)", variablesReference: 21 }],
          });
        }
        return Promise.reject(new Error(`Unexpected DAP command: ${command}`));
      },
    );

    await DebugService.selectFrame(9);

    const state = useDebugStore.getState();
    expect(state.selectedFrameId).toBe(9);
    expect(state.scopes.map((scope) => scope.name)).toEqual(["Locals", "Globals"]);
    expect(state.variablesByReference[11]?.[0]?.value).toBe("42");
    expect(state.variablesByReference[12]?.[0]?.variablesReference).toBe(21);
    expect(state.loadingVariableReferences).toEqual([]);
  });
});

describe("DebugService watch, evaluate and breakpoints", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    useDebugStore.getState().reset();
    useDebugStore.getState().set({
      state: "paused",
      sessionId: "session-1",
      selectedThreadId: 1,
      selectedFrameId: 9,
      threads: [{ id: 1, name: "Main" }],
    });
  });

  it("evaluates an expression against the selected frame and thread", async () => {
    mocks.request.mockImplementation((_sessionId: string, command: string) => {
      if (command === "evaluate") return Promise.resolve({ result: "42", type: "int" });
      return Promise.reject(new Error(`Unexpected DAP command: ${command}`));
    });

    const result = await DebugService.evaluate("user.age", "repl");

    expect(result.value).toBe("42");
    expect(mocks.request).toHaveBeenCalledWith("session-1", "evaluate", {
      expression: "user.age",
      context: "repl",
      frameId: 9,
      threadId: 1,
    });
  });

  it("rejects evaluation when the session is not paused", async () => {
    useDebugStore.getState().set({ state: "running" });
    await expect(DebugService.evaluate("x")).rejects.toThrow("未暂停");
  });

  it("adds a watch expression and evaluates it", async () => {
    mocks.request.mockImplementation((_sessionId: string, command: string) => {
      if (command === "evaluate") return Promise.resolve({ result: "7" });
      return Promise.reject(new Error(`Unexpected DAP command: ${command}`));
    });

    await DebugService.addWatch("items.length");

    const watch = useDebugStore.getState().watchExpressions[0];
    expect(watch?.expression).toBe("items.length");
    expect(watch?.value).toBe("7");
  });

  it("syncs only enabled breakpoints and clears verification for disabled ones", async () => {
    useDebugStore.getState().set({
      breakpoints: [
        { path: "C:/a.py", line: 10 },
        { path: "C:/a.py", line: 20, enabled: false },
      ],
    });
    mocks.request.mockImplementation(
      (
        _sessionId: string,
        command: string,
        arguments_: { breakpoints?: Array<{ line: number }> },
      ) => {
        if (command === "setBreakpoints") {
          expect(arguments_.breakpoints?.map((item) => item.line)).toEqual([10]);
          return Promise.resolve({ breakpoints: [{ line: 10, verified: true }] });
        }
        return Promise.reject(new Error(`Unexpected DAP command: ${command}`));
      },
    );

    await DebugService.syncBreakpoints();

    const state = useDebugStore.getState();
    expect(state.breakpoints[0]?.verified).toBe(true);
    expect(state.breakpoints[1]?.verified).toBeUndefined();
  });

  it("sends conditions, hit conditions and log messages for enabled breakpoints", async () => {
    useDebugStore.getState().set({
      breakpoints: [
        {
          path: "C:/a.py",
          line: 10,
          condition: "x > 10",
          hitCondition: "3",
          logMessage: "x = {x}",
        },
      ],
    });
    mocks.request.mockImplementation(
      (
        _sessionId: string,
        command: string,
        arguments_: { breakpoints?: Array<Record<string, unknown>> },
      ) => {
        if (command === "setBreakpoints") {
          expect(arguments_.breakpoints?.[0]).toEqual({
            line: 10,
            condition: "x > 10",
            hitCondition: "3",
            logMessage: "x = {x}",
          });
          return Promise.resolve({ breakpoints: [{ line: 10, verified: true }] });
        }
        return Promise.reject(new Error(`Unexpected DAP command: ${command}`));
      },
    );

    await DebugService.syncBreakpoints();
  });

  it("selects a thread and loads its first stack frame", async () => {
    mocks.request.mockImplementation((_sessionId: string, command: string) => {
      if (command === "stackTrace") {
        return Promise.resolve({
          stackFrames: [{ id: 5, name: "main", line: 1, column: 1 }],
        });
      }
      if (command === "scopes") return Promise.resolve({ scopes: [] });
      return Promise.reject(new Error(`Unexpected DAP command: ${command}`));
    });

    await DebugService.selectThread(1);

    const state = useDebugStore.getState();
    expect(state.selectedThreadId).toBe(1);
    expect(state.stackFrames[0]?.id).toBe(5);
    expect(state.selectedFrameId).toBe(5);
  });

  it("loads large variable children in pages", async () => {
    mocks.request.mockImplementation(
      (_sessionId: string, command: string, arguments_: { start?: number }) => {
        if (command === "variables") {
          if (arguments_.start === 0) {
            return Promise.resolve({
              variables: Array.from({ length: 100 }, (_, index) => ({
                name: `v${index}`,
                value: String(index),
                variablesReference: 0,
              })),
            });
          }
          if (arguments_.start === 100) {
            return Promise.resolve({
              variables: [{ name: "v100", value: "100", variablesReference: 0 }],
            });
          }
        }
        return Promise.reject(new Error(`Unexpected DAP command: ${command}`));
      },
    );

    await DebugService.loadVariables(21, 0, 150);
    await DebugService.loadVariables(21, 100, 150);

    const state = useDebugStore.getState();
    expect(state.variablesByReference[21]).toHaveLength(101);
    expect(state.variablePagination[21]).toEqual({ nextStart: 101, hasMore: false });
  });
});
