import { describe, expect, it } from "vitest";
import { getSettingsSectionTitleKey, sectionForSettingCategory } from "./SettingsTab";

describe("Settings navigation", () => {
  it("uses the active section for its title", () => {
    expect(getSettingsSectionTitleKey("security")).toBe("settings.categories.security");
    expect(getSettingsSectionTitleKey("general")).toBe("settings.categories.general");
    expect(getSettingsSectionTitleKey("codeIntelligence")).toBe(
      "settings.categories.codeIntelligence",
    );
    expect(getSettingsSectionTitleKey("advanced")).toBe("settings.categories.advanced");
  });

  it("maps search categories to the same navigation sections", () => {
    expect(sectionForSettingCategory("security")).toBe("security");
    expect(sectionForSettingCategory("appearance")).toBe("appearance");
    expect(sectionForSettingCategory("codeIntelligence")).toBe("codeIntelligence");
    expect(sectionForSettingCategory("accountCloud")).toBe("accountCloud");
  });
});
