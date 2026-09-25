import IconCode from "@tabler/icons-react/dist/esm/icons/IconCode.mjs";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";
import "./EditorCapsule.css";

export type EditorViewMode = "source" | "preview";

type EditorCapsuleProps = {
  mode: EditorViewMode;
  onModeChange: (mode: EditorViewMode) => void;
  sourceLabel: string;
  previewLabel: string;
};

export function EditorCapsule({
  mode,
  onModeChange,
  sourceLabel,
  previewLabel,
}: EditorCapsuleProps) {
  return (
    <div className="editor-capsule-position pointer-events-none absolute left-1/2 z-30 -translate-x-1/2">
      <div
        role="toolbar"
        aria-label="Aurona AI Capsule"
        className="editor-capsule glass-layer-overlay pointer-events-auto relative flex items-center"
      >
        <div className="editor-capsule-track relative z-10 flex items-center">
          <Tooltip content={sourceLabel} delay={300}>
            <button
              type="button"
              aria-label={sourceLabel}
              aria-pressed={mode === "source"}
              onClick={() => onModeChange("source")}
              className="editor-capsule-button grid shrink-0 place-items-center"
            >
              <IconCode size={16} stroke={1.8} />
            </button>
          </Tooltip>
          <Tooltip content={previewLabel} delay={300}>
            <button
              type="button"
              aria-label={previewLabel}
              aria-pressed={mode === "preview"}
              onClick={() => onModeChange("preview")}
              className="editor-capsule-button grid shrink-0 place-items-center"
            >
              <Icons.Eye size={16} stroke={1.8} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
