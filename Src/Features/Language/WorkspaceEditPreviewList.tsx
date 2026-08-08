import type { WorkspaceEditPreview } from "../../Core/LanguageFeatureService";
import { useLocale } from "../../Foundation/I18n";
import { fileUriToPath } from "../../Shared/Utils/UriUtils";
import { Icons } from "../../UI/Icons/IconManager";

export function WorkspaceEditPreviewList({ preview }: { preview: WorkspaceEditPreview }) {
  const { t } = useLocale();
  return (
    <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl bg-[var(--material-surface)] p-2 aurona-scroll">
      {preview.files.map((file) => (
        <section
          key={file.uri}
          className="overflow-hidden rounded-lg border border-[var(--border-subtle)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5">
            <Icons.FileCode size={13} className="shrink-0 text-[var(--color-text-muted)]" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-muted)]">
              {fileUriToPath(file.uri) ?? file.uri}
            </span>
            <span className="shrink-0 rounded-full bg-[var(--material-interactive-hover)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-muted)]">
              {t("language.changesCount").replace("{count}", String(file.editCount))}
            </span>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {file.edits.map((edit) => (
              <div
                key={`${file.uri}-${edit.line}-${edit.oldText}-${edit.newText}`}
                className="px-2.5 py-1.5 font-mono text-[11px] leading-5"
              >
                <span className="mr-2 text-[9px] text-[var(--color-text-muted)]">
                  {t("language.linePrefix").replace("{line}", String(edit.line))}
                </span>
                <div className="flex min-w-0 items-start gap-2">
                  <span className="w-4 shrink-0 select-none text-[var(--StatusError)]">−</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--StatusError)]/90 line-through decoration-[var(--StatusError)]/40">
                    {edit.oldText || " "}
                  </span>
                </div>
                <div className="flex min-w-0 items-start gap-2">
                  <span className="w-4 shrink-0 select-none text-[var(--StatusSuccess)]">+</span>
                  <span className="min-w-0 flex-1 truncate whitespace-pre text-[var(--StatusSuccess)]">
                    {edit.newText || " "}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
