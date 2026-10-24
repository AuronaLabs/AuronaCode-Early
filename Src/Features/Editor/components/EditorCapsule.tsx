import IconCode from "@tabler/icons-react/dist/esm/icons/IconCode.mjs";
import { type KeyboardEvent, useRef } from "react";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";
import "./EditorCapsule.css";

export type EditorViewMode = "source" | "preview";

type EditorCapsuleProps = {
  mode: EditorViewMode;
  onModeChange: (mode: EditorViewMode) => void;
  sourceLabel: string;
  previewLabel: string;
  capsuleLabel: string;
};

export function EditorCapsule({
  mode,
  onModeChange,
  sourceLabel,
  previewLabel,
  capsuleLabel,
}: EditorCapsuleProps) {
  const sourceRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next =
      event.key === "ArrowRight" || event.key === "End"
        ? "preview"
        : event.key === "ArrowLeft" || event.key === "Home"
          ? "source"
          : null;
    if (!next) return;
    event.preventDefault();
    onModeChange(next);
    (next === "source" ? sourceRef : previewRef).current?.focus();
  };
  return (
    <div className="editor-capsule-position pointer-events-none absolute left-1/2 z-30 -translate-x-1/2">
      <div
        role="toolbar"
        aria-label={capsuleLabel}
        className="editor-capsule glass-layer-overlay pointer-events-auto"
      >
        <Tooltip content={sourceLabel} delay={300}>
          <button
            ref={sourceRef}
            type="button"
            aria-label={sourceLabel}
            aria-pressed={mode === "source"}
            onClick={() => onModeChange("source")}
            onKeyDown={handleKeyDown}
            className="editor-capsule-button"
          >
            <IconCode size={17} stroke={1.8} aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip content={previewLabel} delay={300}>
          <button
            ref={previewRef}
            type="button"
            aria-label={previewLabel}
            aria-pressed={mode === "preview"}
            onClick={() => onModeChange("preview")}
            onKeyDown={handleKeyDown}
            className="editor-capsule-button"
          >
            <Icons.Eye size={17} stroke={1.8} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
