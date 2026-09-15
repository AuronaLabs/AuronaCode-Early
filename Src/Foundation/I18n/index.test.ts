import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { de } from "./locales/de";
import { en } from "./locales/en";
import { it as itMessages } from "./locales/it";
import { ja } from "./locales/ja";
import { zhCN } from "./locales/zh-CN";
import { zhHant } from "./locales/zh-Hant";

/** 递归收集消息树的所有叶子键路径。 */
function collectKeys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    collectKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("LocaleService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("switches to traditional Chinese (Hant) and persists the choice", async () => {
    const { LocaleService } = await import("./index");
    LocaleService.set("zh-Hant");
    expect(LocaleService.get()).toBe("zh-Hant");
    expect(LocaleService.translate("settings.title")).toBe("設定");
    expect(LocaleService.translate("explorer.title")).toBe("檔案總管");
    expect(localStorage.getItem("aurona.locale")).toBe("zh-Hant");
  });

  it("round-trips all three locales through persistence", async () => {
    const { LocaleService } = await import("./index");
    LocaleService.set("zh-CN");
    expect(LocaleService.translate("settings.title")).toBe("设置");
    LocaleService.set("en");
    expect(LocaleService.translate("settings.title")).toBe("Settings");
    LocaleService.set("zh-Hant");
    expect(localStorage.getItem("aurona.locale")).toBe("zh-Hant");
  });

  it("migrates the legacy zh-TW value to zh-Hant", async () => {
    localStorage.setItem("aurona.locale", "zh-TW");
    vi.resetModules();
    const { LocaleService } = await import("./index");
    expect(LocaleService.get()).toBe("zh-Hant");
    expect(localStorage.getItem("aurona.locale")).toBe("zh-Hant");
  });

  it("falls back to zh-CN for an unknown persisted locale", async () => {
    localStorage.setItem("aurona.locale", "fr-FR");
    vi.resetModules();
    const { LocaleService } = await import("./index");
    expect(LocaleService.get()).toBe("zh-CN");
  });

  it("every locale covers exactly the zh-CN key tree (防漏译)", () => {
    const reference = collectKeys(zhCN).sort();
    for (const [name, messages] of [
      ["zh-Hant", zhHant],
      ["en", en],
      ["de", de],
      ["it", itMessages],
      ["ja", ja],
    ] as const) {
      expect(collectKeys(messages).sort(), `locale "${name}" key mismatch`).toEqual(reference);
    }
  });
});
