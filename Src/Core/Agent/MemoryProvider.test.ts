import { describe, expect, it } from "vitest";
import { InMemoryMemoryProvider } from "./MemoryProvider";

describe("InMemoryMemoryProvider", () => {
  it("stores, filters, updates, and limits memory entries", async () => {
    const provider = new InMemoryMemoryProvider();
    await provider.store({ id: "one", text: "Use the dark editor theme", scope: "project" });
    await provider.store({ id: "two", text: "Run the typecheck before release", scope: "project" });
    await provider.store({ id: "one", text: "Use the compact editor theme", scope: "project" });

    await expect(provider.query("compact", { scope: "project" })).resolves.toMatchObject([
      { id: "one", text: "Use the compact editor theme" },
    ]);
    await expect(provider.query("", { limit: 1 })).resolves.toHaveLength(1);
    await expect(provider.query("theme", { scope: "other" })).resolves.toEqual([]);
  });
});
