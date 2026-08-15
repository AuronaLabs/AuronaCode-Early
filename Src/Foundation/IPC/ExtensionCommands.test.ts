import { describe, expect, it, vi } from "vitest";

const { invokeDesktopMock } = vi.hoisted(() => ({
  invokeDesktopMock: vi.fn(),
}));

vi.mock("../Desktop/Transport", () => ({
  invokeDesktop: invokeDesktopMock,
}));

import { ExtensionIPC } from "./ExtensionCommands";

describe("ExtensionCommands", () => {
  it("passes a struct render request under the request key", async () => {
    invokeDesktopMock.mockResolvedValue({
      html: "<p>ok</p>",
      diagnostics: [],
      metrics: { packageOpenMs: 0, wasmCompileMs: 1, renderMs: 2 },
    });

    await ExtensionIPC.render({
      extensionId: "aurona.markdown",
      markdown: "# Hello",
      activeEditorPath: "C:\\repo\\README.md",
      theme: "dark",
      locale: "zh-CN",
    });

    expect(invokeDesktopMock).toHaveBeenCalledWith("extensions_render", {
      request: {
        extensionId: "aurona.markdown",
        markdown: "# Hello",
        activeEditorPath: "C:\\repo\\README.md",
        theme: "dark",
        locale: "zh-CN",
      },
    });
  });

  it("keeps scalar permission arguments camelCase", async () => {
    invokeDesktopMock.mockResolvedValue("granted");
    await ExtensionIPC.setPermission("aurona.markdown", "editor.current.read", true);
    expect(invokeDesktopMock).toHaveBeenCalledWith("extensions_set_permission", {
      extensionId: "aurona.markdown",
      permission: "editor.current.read",
      granted: true,
    });
  });
});
