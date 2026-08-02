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
