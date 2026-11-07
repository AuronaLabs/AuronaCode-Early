import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserConfig } from "../../Foundation/Types/Config";

const mocks = vi.hoisted(() => ({ get: vi.fn(), subscribe: vi.fn(), glass: vi.fn() }));
vi.mock("../../Foundation/Storage/UserConfigStore", () => ({ UserConfigStore: mocks }));
vi.mock("../../UI/Core/GlassManager", () => ({
  useGlassStore: { getState: () => ({ setIntensity: mocks.glass }) },
}));
vi.mock("../ThemeAccent", () => ({ applyAccentTheme: vi.fn(), applyLiquidTexture: vi.fn() }));

import { startAppearanceController } from "./AppearanceController";

describe("appearance configuration projection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
  });
  it("projects committed settings and system changes, and removes every listener on dispose", async () => {
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media),
    );
    const unsubscribe = vi.fn();
    let change!: (config: UserConfig) => void;
    mocks.subscribe.mockImplementation((callback) => {
      change = callback;
      return unsubscribe;
    });
    mocks.get.mockResolvedValue({ theme: "system", editorFontSize: 16 });
    const dispose = await startAppearanceController();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--EditorFontSize")).toBe("16px");
    change({ theme: "light", editorFontSize: 18 });
    media.addEventListener.mock.calls[0][1]();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--EditorFontSize")).toBe("18px");
    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(media.removeEventListener).toHaveBeenCalledWith(
      "change",
      media.addEventListener.mock.calls[0][1],
    );
  });
});
