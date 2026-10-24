import { useEffect, useMemo, useRef } from "react";
import { buildCompatWebviewDocument } from "../../Foundation/Security/CompatWebviewDocument";
import type { CompatWebviewState } from "../../Foundation/Types/ExtensionUI";

export function CompatWebview({
  panel,
  theme,
  onAction,
}: {
  panel: CompatWebviewState;
  theme: string;
  onAction?: (id: string, payload?: unknown) => void | Promise<void>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const state = useRef<unknown>(undefined);
  const channel = useRef(crypto.randomUUID()).current;
  const delivered = useRef(0);
  const ready = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const html = useMemo(
    () =>
      buildCompatWebviewDocument(panel.html, panel.enableScripts, channel, theme, state.current),
    [panel.html, panel.enableScripts, channel, theme],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new srcDoc must wait for its own load event
  useEffect(() => {
    ready.current = false;
  }, [html]);
  useEffect(() => {
    let active = true;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
      let size: number;
      try {
        size = JSON.stringify(event.data.value)?.length ?? 0;
      } catch {
        return;
      }
      if (size > 65536) return;
      if (event.data.kind === "state") state.current = event.data.value;
      if (event.data.kind === "message") {
        queue.current = queue.current
          .then(async () => {
            if (active) await onAction?.(`webview:${panel.id}`, event.data.value);
          })
          .catch(console.error);
      }
    };
    window.addEventListener("message", receive);
    return () => {
      active = false;
      window.removeEventListener("message", receive);
    };
  }, [channel, onAction, panel.id]);
  const sendMessages = () => {
    if (!ready.current) return;
    for (const message of panel.messages) {
      if (!message || typeof message.sequence !== "number" || message.sequence <= delivered.current)
        continue;
      frame.current?.contentWindow?.postMessage({ channel, value: message.value }, "*");
      delivered.current = message.sequence;
    }
  };
  useEffect(sendMessages, [panel.messages, channel]);
  return (
    <section className="flex min-h-64 flex-col border-t border-[var(--color-border)]">
      <h3 className="px-3 py-2 text-xs font-medium">{panel.title}</h3>
      {/* biome-ignore lint/a11y/useIframeTitle: aria-label names the isolated view */}
      <iframe
        ref={frame}
        sandbox={panel.enableScripts ? "allow-scripts" : ""}
        srcDoc={html}
        aria-label={panel.title}
        onLoad={() => {
          ready.current = true;
          sendMessages();
        }}
        className="min-h-64 w-full flex-1 border-0 bg-transparent"
      />
    </section>
  );
}
