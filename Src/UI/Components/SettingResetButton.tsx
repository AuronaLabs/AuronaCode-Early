import { Tooltip } from "../Feedback/Tooltip";
import { Icons } from "../Icons/IconManager";

export function SettingResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <Tooltip content={label} delay={300} placement="top">
      <button
        type="button"
        aria-label={label}
        onClick={onReset}
        className="shrink-0 rounded-md p-1 text-[var(--color-text-muted)] opacity-60 transition-opacity hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] hover:opacity-100"
      >
        <Icons.Refresh size={12} />
      </button>
    </Tooltip>
  );
}
