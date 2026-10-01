import IconCode from "@tabler/icons-react/dist/esm/icons/IconCode.mjs";
import type { KeyboardEvent } from "react";
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
  dirtyLabel: string;
  /** The capsule is a local editor control; keep the current document visible without
   * turning it into a second toolbar or a live AI surface. */
  fileName?: string;
  filePath?: string;
  language?: string;
  isDirty?: boolean;
  copyPathLabel?: string;
  onCopyPath?: () => void;
};

export function EditorCapsule({
  mode,
  onModeChange,
  sourceLabel,
  previewLabel,
  capsuleLabel,
  dirtyLabel,
  fileName,
  filePath,
  language,
  isDirty = false,
  copyPathLabel,
  onCopyPath,
}: EditorCapsuleProps) {
  const handleModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: EditorViewMode) => {
    if (current === "source" && event.key === "ArrowRight") {
      event.preventDefault();
      onModeChange("preview");
    } else if (current === "preview" && event.key === "ArrowLeft") {
      event.preventDefault();
      onModeChange("source");
    }
  };

  return (
    <div className="editor-capsule-position pointer-events-none absolute left-1/2 z-30 -translate-x-1/2">
      <div
        role="toolbar"
        aria-label={capsuleLabel}
        aria-description={filePath}
        className="editor-capsule glass-layer-overlay pointer-events-auto relative flex items-center"
      >
        {fileName && (
          <div className="editor-capsule-context">
            <Icons.FileCode size={15} stroke={1.7} />
            <span className="editor-capsule-file-name">{fileName}</span>
            {language && <span className="editor-capsule-language">{language}</span>}
            {isDirty && (
              <span className="editor-capsule-dirty" role="img" aria-label={dirtyLabel} />
            )}
          </div>
        )}
        <div className="editor-capsule-track relative z-10 flex items-center">
          <Tooltip content={sourceLabel} delay={300}>
            <button
              type="button"
              aria-label={sourceLabel}
              aria-pressed={mode === "source"}
              onClick={() => onModeChange("source")}
              onKeyDown={(event) => handleModeKeyDown(event, "source")}
              className="editor-capsule-button editor-capsule-mode grid shrink-0 place-items-center"
            >
              <IconCode size={16} stroke={1.8} />
              <span className="editor-capsule-mode-label">{sourceLabel}</span>
            </button>
          </Tooltip>
          <Tooltip content={previewLabel} delay={300}>
            <button
              type="button"
              aria-label={previewLabel}
              aria-pressed={mode === "preview"}
              onClick={() => onModeChange("preview")}
              onKeyDown={(event) => handleModeKeyDown(event, "preview")}
              className="editor-capsule-button editor-capsule-mode grid shrink-0 place-items-center"
            >
              <Icons.Eye size={16} stroke={1.8} />
              <span className="editor-capsule-mode-label">{previewLabel}</span>
            </button>
          </Tooltip>
        </div>
        {onCopyPath && filePath && (
          <Tooltip content={copyPathLabel ?? filePath} delay={300}>
            <button
              type="button"
              aria-label={copyPathLabel ?? filePath}
              onClick={onCopyPath}
              className="editor-capsule-copy grid shrink-0 place-items-center"
            >
              <Icons.Copy size={14} stroke={1.8} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
