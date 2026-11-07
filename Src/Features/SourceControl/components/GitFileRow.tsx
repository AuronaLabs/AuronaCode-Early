import type { GitFile } from "../../../Core/Git";
import { useLocale } from "../../../Foundation/I18n";
import { cn } from "../../../Shared/Utils/cn";
import { glassListRowStyles } from "../../../UI/Components/GlassList";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";

function getStatusBadgeStyle(status: string) {
  switch (status) {
    case "M":
      return "text-[var(--StatusWarning)] bg-[var(--StatusWarning)]/10 border border-[var(--StatusWarning)]/20";
    case "A":
      return "text-[var(--StatusSuccess)] bg-[var(--StatusSuccess)]/10 border border-[var(--StatusSuccess)]/20";
    case "D":
      return "text-[var(--StatusError)] bg-[var(--StatusError)]/10 border border-[var(--StatusError)]/20";
    case "U":
    case "?":
      return "border border-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-accent)]";
    case "!":
      return "border border-[var(--StatusError)]/20 bg-[var(--StatusError)]/10 text-[var(--StatusError)]";
    default:
      return "text-[var(--color-text-muted)] bg-[var(--material-surface)] border border-transparent";
  }
}

export function GitFileRow({
  file,
  disabled,
  onOpen,
  onStage,
  onDiscard,
}: {
  file: GitFile;
  disabled: boolean;
  onOpen: (file: GitFile) => void;
  onStage: (file: GitFile) => void;
  onDiscard: (file: GitFile) => void;
}) {
  const { t } = useLocale();
  const parentPath = file.path.split("/").slice(0, -1).join("/") || "/";
  return (
    <div className={cn(glassListRowStyles, "mx-1 my-0.5 cursor-pointer justify-between")}>
      <button
        type="button"
        onClick={() => onOpen(file)}
        className="mr-2 flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left"
      >
        <Icons.FileCode
          size={14}
          stroke={1.5}
          className="text-[var(--color-text-muted)] shrink-0"
        />
        <span className="text-[12.5px] font-medium text-[var(--color-text-highlight)] truncate min-w-0">
          {file.name}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] truncate opacity-70 group-hover:opacity-100 transition-opacity min-w-0">
          {parentPath}
        </span>
      </button>

      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className={`text-[10px] px-1.5 py-[1px] rounded flex items-center justify-center font-bold tracking-wide select-none ${getStatusBadgeStyle(file.status)}`}
        >
          {file.status}
        </span>
        <div className="opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100 transition-all flex items-center shrink-0">
          {!file.is_staged && (
            <Tooltip content={t("sourceControl.discardFile")} delay={300}>
              <button
                type="button"
                disabled={disabled}
                aria-label={t("sourceControl.discardFile")}
                onClick={(event) => {
                  event.stopPropagation();
                  onDiscard(file);
                }}
                className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--StatusError)]/10 hover:text-[var(--StatusError)]"
              >
                <Icons.Trash size={11} stroke={2.2} />
              </button>
            </Tooltip>
          )}
          {file.is_staged ? (
            <Tooltip content={t("sourceControl.unstage")} delay={300}>
              <button
                type="button"
                disabled={disabled}
                aria-label={t(file.is_staged ? "sourceControl.unstage" : "sourceControl.stage")}
                onClick={(event) => {
                  event.stopPropagation();
                  onStage(file);
                }}
                className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-text-primary)] transition-colors disabled:opacity-40 hover:bg-[var(--material-interactive-active)] hover:text-[var(--StatusError)]"
              >
                <Icons.Minus size={11} stroke={3} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={t("sourceControl.stage")} delay={300}>
              <button
                type="button"
                disabled={disabled}
                aria-label={t(file.is_staged ? "sourceControl.unstage" : "sourceControl.stage")}
                onClick={(event) => {
                  event.stopPropagation();
                  onStage(file);
                }}
                className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-text-primary)] transition-colors disabled:opacity-40 hover:bg-[var(--material-interactive-active)] hover:text-[var(--color-text-highlight)]"
              >
                <Icons.Plus size={11} stroke={3} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
