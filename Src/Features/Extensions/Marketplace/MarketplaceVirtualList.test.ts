import { marketplaceWindow } from "./MarketplaceVirtualList";

describe("Marketplace virtualization", () => {
  it("keeps the mounted window bounded across a million catalog entries", () => {
    for (const top of [0, 10000, 1000000, 176000000 - 600]) {
      const window = marketplaceWindow(1000000, top, 600);
      expect(window.end - window.start).toBeLessThanOrEqual(11);
      expect(window.end).toBeLessThanOrEqual(1000000);
      expect(window.total).toBe(176000000);
    }
  });
});
