import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentService } from "../../../Core/DocumentService";
import { LspClient } from "../../../Core/Language/LspClient";
import { OutputService } from "../../../Core/OutputService";
import type { LanguageFeaturePreferences } from "../../../Foundation/Types/Config";
import type { EditorHoverState } from "../components/HoverCard";
import type { EditorOverlayAnchor } from "../Utils/EditorOverlay";

interface UseEditorHoverOptions {
  path?: string;
  language: string;
  preferences: Required<LanguageFeaturePreferences>;
  interactionBlocked: () => boolean;
}

function hoverText(
  contents:
    | string
    | { kind?: string; value: string }
    | Array<string | { language?: string; value: string }>,
): string {
  const values = Array.isArray(contents) ? contents : [contents];
  return values
    .map((value) => (typeof value === "string" ? value : value.value))
    .filter(Boolean)
    .join("\n\n");
}

export function useEditorHover({
  path,
  language,
  preferences,
  interactionBlocked,
}: UseEditorHoverOptions) {
  const [tooltip, setTooltip] = useState<EditorHoverState | null>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const targetRef = useRef<{ line: number; character: number } | null>(null);
  const contextMenuOpenRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    hoverTimerRef.current = null;
    closeTimerRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    generationRef.current++;
    targetRef.current = null;
    clearTimers();
    setTooltip(null);
  }, [clearTimers]);

  const setVisibleTooltip = useCallback((next: EditorHoverState | null) => {
    if (next === null || !contextMenuOpenRef.current) setTooltip(next);
  }, []);

  const setContextMenuOpen = useCallback(
    (open: boolean) => {
      contextMenuOpenRef.current = open;
      setIsContextMenuOpen(open);
      if (open) dismiss();
    },
    [dismiss],
  );

  const requestLanguageHover = useCallback(
    (line: number, character: number, anchor: EditorOverlayAnchor) => {
      if (!path || !preferences.hoverEnabled || contextMenuOpenRef.current) return;
      if (interactionBlocked()) return;
      if (targetRef.current?.line === line && targetRef.current.character === character) return;
      targetRef.current = { line, character };

      const client = LspClient.getInstance();
      const server = client.getState(language);
      if (server?.status !== "running") {
        setVisibleTooltip({
          anchor,
          title: "语言服务未运行",
          text: server?.lastError ?? `${language} 语言服务器尚未启动`,
          tone: server?.status === "failed" ? "error" : "warning",
        });
        return;
      }
      if (!client.supports(language, "hover")) {
        setVisibleTooltip({
          anchor,
          title: "当前服务器不支持 Hover",
          text: `${language} 语言服务器没有声明 hoverProvider 能力`,
          tone: "warning",
        });
        return;
      }

      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
      const generation = ++generationRef.current;
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        void DocumentService.flush(path)
          .then(() => client.getHoverInfo(language, path, line, character))
          .then((hover) => {
            if (
              generation !== generationRef.current ||
              contextMenuOpenRef.current ||
              interactionBlocked() ||
              !hover
            ) {
              return;
            }
            const text = hoverText(hover.contents);
            if (text) {
              setTooltip({ anchor, title: "语言信息", source: language, text });
            }
          })
          .catch((error) => {
            if (generation !== generationRef.current || contextMenuOpenRef.current) return;
            const message = error instanceof Error ? error.message : String(error);
            OutputService.append("language-server", `Hover failed: ${message}`, "warn");
            setTooltip({
              anchor,
              title: "Hover 请求失败",
              text: message,
              tone: "warning",
            });
          });
      }, preferences.hoverDelayMs);
    },
    [interactionBlocked, language, path, preferences, setVisibleTooltip],
  );

  const handleLineMouseLeave = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(dismiss, 140);
  }, [dismiss]);

  const handleTooltipMouseEnter = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  useEffect(
    () => () => {
      generationRef.current++;
      clearTimers();
    },
    [clearTimers],
  );

  return {
    tooltip,
    isContextMenuOpen,
    dismiss,
    setVisibleTooltip,
    setContextMenuOpen,
    requestLanguageHover,
    handleLineMouseLeave,
    handleTooltipMouseEnter,
    handleTooltipMouseLeave: dismiss,
  };
}
