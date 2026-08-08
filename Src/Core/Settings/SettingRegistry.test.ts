import { describe, expect, it } from "vitest";
import { LocaleService } from "../../Foundation/I18n";
import { getAllSettings, getSettingsByCategory, searchSettings } from "./SettingRegistry";

describe("SettingRegistry", () => {
  it("exposes registered settings grouped by category", () => {
    expect(getAllSettings().length).toBeGreaterThan(10);
    const editor = getSettingsByCategory("editor");
    expect(editor.some((setting) => setting.id === "editorFontSize")).toBe(true);
    const general = getSettingsByCategory("general");
    expect(general.some((setting) => setting.id === "language")).toBe(true);
    expect(general.some((setting) => setting.id === "density")).toBe(true);
    const appearance = getSettingsByCategory("appearance");
    expect(appearance.some((setting) => setting.id === "materialIntensity")).toBe(true);
    const advanced = getSettingsByCategory("advanced");
    expect(advanced.every((setting) => setting.experimental)).toBe(true);
  });

  it("searches settings with bilingual keywords", () => {
    const byChinese = searchSettings("流光", (key) => LocaleService.translate(key, "zh-CN"));
    expect(byChinese.some((setting) => setting.id === "liquidTexture")).toBe(true);

    const byEnglish = searchSettings("hover delay", (key) => LocaleService.translate(key, "en"));
    expect(byEnglish.some((setting) => setting.id === "hoverDelayMs")).toBe(true);
  });
});
