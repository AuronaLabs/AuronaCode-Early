import { MarketplaceView } from "./Marketplace/MarketplaceView";

export function ExtensionsPanel() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      <MarketplaceView />
    </div>
  );
}
