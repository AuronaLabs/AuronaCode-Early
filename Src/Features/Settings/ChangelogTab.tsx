import { Icons } from "../../UI/Icons/IconManager";
import { CHANGELOG_DATA } from "./ChangelogData";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";

export function ChangelogTab() {
  return (
    <InternalPageLayout title="发行说明">
      <div className="flex flex-col gap-12 max-w-3xl">
        {CHANGELOG_DATA.map((release) => (
          <div key={release.version} className={`flex flex-col gap-6 ${!release.isLatest ? "opacity-75" : ""}`}>
            <div className="flex items-center gap-4 border-b border-[var(--ColorPanelBorder)] pb-2">
              <span className="text-[18px] font-bold text-[var(--ColorTextHighlight)] tracking-tight">{release.version}</span>
              <span className="text-[12px] font-medium text-[var(--ColorMuted)] bg-black/[0.04] dark:bg-white/[0.04] px-2 py-0.5 rounded-md">{release.date}</span>
              {release.isLatest && (
                <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase tracking-wider">
                  Latest Release
                </span>
              )}
            </div>

            <div className="flex flex-col gap-8">
              {release.sections.map((section) => (
                <div key={section.title} className="flex flex-col gap-3">
                  <h3 className="text-[14px] font-semibold text-[var(--ColorTextHighlight)]">{section.title}</h3>
                  <ul className="flex flex-col gap-2.5 text-[13px] text-[var(--ColorText)] leading-relaxed">
                    {section.items.map((item, idx) => (
                      <li key={idx} className="flex gap-3">
                        <span className={release.isLatest ? "text-[var(--ColorAccent)]" : "text-[var(--ColorMuted)]"}>•</span>
                        <span className="opacity-90">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </InternalPageLayout>
  );
}
