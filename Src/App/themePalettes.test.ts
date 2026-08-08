import { afterEach, describe, expect, it } from "vitest";
import { ACCENT_THEMES } from "./ThemeAccent";
import { buildThemePreviewGradient, getThemeDefinition, THEME_DEFINITIONS } from "./themePalettes";

describe("theme palettes", () => {
  afterEach(() => {
    delete document.documentElement.dataset.accent;
    delete document.documentElement.dataset.liquidTexture;
  });

  it("covers all eight theme ids with the Aurora default", () => {
    const ids = THEME_DEFINITIONS.map((theme) => theme.id);
    expect(ids).toHaveLength(8);
    expect(ids).toEqual(ACCENT_THEMES.map((theme) => theme.id));
    expect(THEME_DEFINITIONS.find((theme) => theme.isDefault)?.id).toBe("aurora");
    for (const theme of THEME_DEFINITIONS) {
      const source = ACCENT_THEMES.find((accent) => accent.id === theme.id);
      expect(source).toBeDefined();
      expect(theme.accentRgb).toBe(source?.rgb);
    }
  });

  it("provides light and dark palettes with three ambient fields for every theme", () => {
    for (const theme of THEME_DEFINITIONS) {
      expect(theme.palettes.light.fields).toHaveLength(3);
      expect(theme.palettes.dark.fields).toHaveLength(3);
      expect(theme.palettes.light.baseStart).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.palettes.dark.baseEnd).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.accentRgb).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
      for (const field of [...theme.palettes.light.fields, ...theme.palettes.dark.fields]) {
        expect(field.rgb).toHaveLength(3);
        expect(field.alpha).toBeGreaterThan(0);
        expect(field.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it("builds a layered preview gradient for light and dark modes", () => {
    const aurora = getThemeDefinition("aurora");
    const light = buildThemePreviewGradient(aurora, "light");
    const dark = buildThemePreviewGradient(aurora, "dark");
    expect(light).toContain("radial-gradient");
    expect(light).toContain("linear-gradient(160deg");
    expect(light).not.toBe(dark);
  });

  it("keeps liquid texture compatibility through the data attribute", async () => {
    const { applyLiquidTexture } = await import("./ThemeAccent");
    applyLiquidTexture(true);
    expect(document.documentElement.dataset.liquidTexture).toBe("true");
    applyLiquidTexture(false);
    expect(document.documentElement.dataset.liquidTexture).toBeUndefined();
  });
});
