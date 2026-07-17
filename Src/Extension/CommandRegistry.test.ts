import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "./CommandRegistry";

const context = {
  activeFilePath: null,
  hasActiveEditor: false,
  textInputFocused: false,
  platform: "windows" as const,
  bottomPanelOpen: false,
};

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

describe("CommandRegistry", () => {
  it("uses the same handler for direct execution and keybindings", async () => {
    const handler = vi.fn();
    disposers.push(CommandRegistry.setContextProvider(() => context));
    disposers.push(
      CommandRegistry.register({
        id: "test.execute",
        title: "Execute",
        category: "Test",
        keybindings: [{ key: "k", primary: true }],
        handler,
      }),
    );

    expect((await CommandRegistry.execute("test.execute")).ok).toBe(true);
    expect(
      CommandRegistry.handleKeyDown(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      ),
    ).toBe(true);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not steal ordinary shortcuts from text inputs", () => {
    const input = document.createElement("input");
    const handler = vi.fn();
    disposers.push(CommandRegistry.setContextProvider(() => context));
    disposers.push(
      CommandRegistry.register({
        id: "test.input",
        title: "Input",
        category: "Test",
        keybindings: [{ key: "s", primary: true }],
        handler,
      }),
    );
    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true });
    input.addEventListener("keydown", (keyboardEvent) => {
      expect(CommandRegistry.handleKeyDown(keyboardEvent)).toBe(false);
    });
    input.dispatchEvent(event);
    expect(handler).not.toHaveBeenCalled();
  });
});
