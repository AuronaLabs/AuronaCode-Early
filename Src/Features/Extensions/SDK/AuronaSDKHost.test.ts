import { describe, expect, it } from "vitest";
import { createAuronaSDKHost, ExtensionFliunoRegistry } from "./AuronaSDKHost";

describe("AuronaSDKHost", () => {
  it("provides complete Aurona SDK interface with storage and ui", async () => {
    const sdk = createAuronaSDKHost("test.aurona.ext");
    expect(sdk.version).toBe("1.1.0");
    expect(sdk.env.sdkVersion).toBe("1.1.0");

    // 存储读写
    await sdk.storage.set("theme_mode", "glass_dark");
    const val = await sdk.storage.get("theme_mode");
    expect(val).toBe("glass_dark");

    await sdk.storage.delete("theme_mode");
    const deletedVal = await sdk.storage.get("theme_mode");
    expect(deletedVal).toBeNull();

    // 状态栏
    const item = sdk.ui.createStatusBarItem({
      text: "Aurona Ready",
      alignment: "left",
      priority: 10,
    });
    expect(item.text).toBe("Aurona Ready");
    item.dispose();
  });

  it("supports dynamic Fliuno custom search provider registration", async () => {
    const sdk = createAuronaSDKHost("test.aurona.ext");

    let searched = false;
    const unregister = sdk.fliuno.registerProvider({
      id: "test.todo.provider",
      title: "Todo Items",
      search: (query) => {
        searched = true;
        return [
          {
            id: "todo-1",
            title: `Task: ${query}`,
            onSelect: () => {},
          },
        ];
      },
    });

    const providers = ExtensionFliunoRegistry.getProviders();
    expect(providers.some((p) => p.id === "test.todo.provider")).toBe(true);

    const provider = providers.find((p) => p.id === "test.todo.provider");
    expect(provider).toBeDefined();
    if (provider) {
      const results = await provider.search("Refactor Corona+");
      expect(searched).toBe(true);
      expect(results[0].title).toBe("Task: Refactor Corona+");
    }

    unregister();
    const providersAfter = ExtensionFliunoRegistry.getProviders();
    expect(providersAfter.some((p) => p.id === "test.todo.provider")).toBe(false);
  });
});
