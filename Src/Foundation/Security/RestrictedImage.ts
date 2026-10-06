import { useEffect, useState } from "react";
import { NetworkIPC } from "../IPC/NetworkCommands";
import { extensionSvgDataUrl } from "./ExtensionContent";

const cache = new Map<string, Promise<string>>();
export function localImage(source: string | null | undefined): string | null {
  if (!source || source.length > 3 * 1024 * 1024) return null;
  if (source.trim().startsWith("<svg")) return extensionSvgDataUrl(source);
  if (/^data:image\/(png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(source)) return source;
  return null;
}

export function useRestrictedImage(source: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ source: string; value: string } | null>(null);
  useEffect(() => {
    if (!source || localImage(source) || !/^https?:\/\//.test(source)) return;
    let live = true;
    let pending = cache.get(source);
    if (!pending) {
      if (cache.size >= 64) cache.delete(cache.keys().next().value ?? "");
      pending = NetworkIPC.marketplaceImage(source);
      cache.set(source, pending);
      void pending.catch(() => cache.delete(source));
    }
    void pending.then(
      (value) => {
        if (live) setResolved({ source, value });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [source]);
  return localImage(source) ?? (resolved && resolved.source === source ? resolved.value : null);
}
