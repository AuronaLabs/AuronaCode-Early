import { describe, expect, it } from "vitest";
import {
  createMarketplaceViewState,
  MarketplaceRequestCoordinator,
  updateMarketplaceModeState,
} from "./MarketplaceState";

describe("Marketplace view state", () => {
  it("keeps query, filter, scroll and selection independent per mode", () => {
    const initial = createMarketplaceViewState();
    const next = updateMarketplaceModeState(initial, "discover", {
      draftQuery: "markdown",
      committedQuery: "markdown",
      filter: "Themes",
      scrollTop: 240,
      selectedId: "auronalabs.markdown",
    });

    expect(next.discover).toMatchObject({
      draftQuery: "markdown",
      committedQuery: "markdown",
      filter: "Themes",
      scrollTop: 240,
      selectedId: "auronalabs.markdown",
    });
    expect(next.installed).toEqual(initial.installed);
    expect(next.toolchains).toEqual(initial.toolchains);
  });

  it("aborts the previous request and rejects stale responses", () => {
    const coordinator = new MarketplaceRequestCoordinator();
    const first = coordinator.begin();
    const second = coordinator.begin();

    expect(first.controller.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);

    coordinator.abort();
    expect(second.controller.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(second)).toBe(false);
  });
});
