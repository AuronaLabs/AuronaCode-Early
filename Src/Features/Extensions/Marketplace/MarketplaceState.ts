export type MarketplaceMode = "discover" | "installed" | "toolchains";

export interface MarketplaceModeState {
  draftQuery: string;
  committedQuery: string;
  filter: string;
  scrollTop: number;
  selectedId: string | null;
}

export type MarketplaceViewState = Record<MarketplaceMode, MarketplaceModeState>;

export interface MarketplaceRequest {
  sequence: number;
  controller: AbortController;
}

/**
 * Keeps remote Marketplace requests ordered. Starting a request aborts the
 * previous one; callers must also check `isCurrent` before committing data.
 */
export class MarketplaceRequestCoordinator {
  private sequence = 0;
  private activeController: AbortController | null = null;

  begin(): MarketplaceRequest {
    this.activeController?.abort();
    const controller = new AbortController();
    this.activeController = controller;
    this.sequence += 1;
    return { sequence: this.sequence, controller };
  }

  isCurrent(request: MarketplaceRequest): boolean {
    return request.sequence === this.sequence && !request.controller.signal.aborted;
  }

  abort(): void {
    this.activeController?.abort();
    this.activeController = null;
  }
}

export const MARKETPLACE_MODES: readonly MarketplaceMode[] = [
  "discover",
  "installed",
  "toolchains",
];

export function createMarketplaceViewState(): MarketplaceViewState {
  return {
    discover: {
      draftQuery: "",
      committedQuery: "",
      filter: "All",
      scrollTop: 0,
      selectedId: null,
    },
    installed: {
      draftQuery: "",
      committedQuery: "",
      filter: "All",
      scrollTop: 0,
      selectedId: null,
    },
    toolchains: {
      draftQuery: "",
      committedQuery: "",
      filter: "All",
      scrollTop: 0,
      selectedId: null,
    },
  };
}

export function updateMarketplaceModeState(
  state: MarketplaceViewState,
  mode: MarketplaceMode,
  patch: Partial<MarketplaceModeState>,
): MarketplaceViewState {
  return { ...state, [mode]: { ...state[mode], ...patch } };
}
