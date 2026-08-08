import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({}),
  getCurrentWebviewWindow: () => ({}),
}));

const languageMocks = vi.hoisted(() => ({
  findReferences: vi.fn(async () => []),
  goToDefinition: vi.fn(async () => []),
}));

vi.mock("./LanguageFeatureService", () => ({
  LanguageFeatureService: {
    findReferences: languageMocks.findReferences,
    goToDefinition: languageMocks.goToDefinition,
  },
}));

vi.mock("./Language/LspClient", () => ({
  LspClient: {
    getInstance: () => ({
      supports: () => true,
      getState: () => ({ status: "running" }),
      getDocumentSymbols: async () => [],
    }),
  },
}));

vi.mock("./OutputService", () => ({
  OutputService: {
    append: vi.fn(),
    getChannels: () => [],
    getChannel: () => undefined,
  },
}));

import { CommandRegistry } from "../Extension/CommandRegistry";
import { EventBus } from "../Foundation/EventBus";
import { useEditorStore } from "../State/useEditorStore";
import { useWorkbenchStore } from "../State/useWorkspaceStore";
import { registerWorkbenchCommands } from "./Commands";

describe("language command panel routing", () => {
  let disposeCommands: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkbenchStore.setState({
      tabs: [{ id: "C:/repo/a.ts", type: "file", path: "C:/repo/a.ts", title: "a.ts" }],
      activeTabId: "C:/repo/a.ts",
      activeBottomPanel: "problems",
      isBottomPanelOpen: false,
    });
    useEditorStore.setState((state) => ({
      editorStatus: { ...state.editorStatus, language: "typescript", line: 3, column: 5 },
    }));
    if (!disposeCommands) disposeCommands = registerWorkbenchCommands();
  });

  it("keeps references visible instead of switching back to output", async () => {
    languageMocks.findReferences.mockImplementation(async () => {
      EventBus.emit("language:open-location-results");
      return [];
    });
    const unsubscribe = EventBus.on("language:open-location-results", () =>
      useWorkbenchStore.getState().setActiveBottomPanel("references"),
    );

    const result = await CommandRegistry.execute("editor.action.findReferences");

    expect(result.ok).toBe(true);
    expect(languageMocks.findReferences).toHaveBeenCalledWith("C:/repo/a.ts", "typescript", 2, 4);
    expect(useWorkbenchStore.getState().activeBottomPanel).toBe("references");
    unsubscribe();
  });

  it("does not route definition results to output either", async () => {
    languageMocks.goToDefinition.mockImplementation(async () => {
      EventBus.emit("language:open-location-results");
      return [];
    });
    const unsubscribe = EventBus.on("language:open-location-results", () =>
      useWorkbenchStore.getState().setActiveBottomPanel("references"),
    );

    await CommandRegistry.execute("editor.action.goToDefinition");

    expect(useWorkbenchStore.getState().activeBottomPanel).toBe("references");
    unsubscribe();
  });
});
