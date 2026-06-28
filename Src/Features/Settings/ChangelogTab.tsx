import { useState, useMemo } from "react";
import { Icons } from "../../UI/Icons/IconManager";
import { CHANGELOG_DATA } from "./ChangelogData";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";

export function ChangelogTab() {
  const versionFamilies = useMemo(() => {
    const families = new Set<string>();
    CHANGELOG_DATA.forEach(release => {
      const parts = release.version.split('.');
      if (parts.length >= 2) {
        families.add(`V${parts[0].replace('V', '')}.${parts[1]}.X`);
      }
    });
    return Array.from(families);
  }, []);

  const [selectedFamily, setSelectedFamily] = useState<string>(versionFamilies[0] || "All");

  const filteredData = useMemo(() => {
    return CHANGELOG_DATA.filter(release => {
      const parts = release.version.split('.');
      const family = `V${parts[0].replace('V', '')}.${parts[1]}.X`;
      return family === selectedFamily;
    });
  }, [selectedFamily]);

  const pillSelector = (
    <div className="flex bg-black/5 dark:bg-white/5 p-0.5 rounded-full shadow-inner border border-black/5 dark:border-white/5">
      {versionFamilies.map(f => (
        <button 
          key={f} 
          onClick={() => setSelectedFamily(f)}
          className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors duration-200 ${
            selectedFamily === f
              ? "bg-[var(--GlassActive)] text-[var(--TextHighlight)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]" 
              : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)]"
          }`}
        >
          {f} 系列
        </button>
      ))}
    </div>
  );

  return (
    <InternalPageLayout title="更新历史" titleRight={pillSelector}>
      <div className="flex flex-col gap-12 max-w-3xl">
        {filteredData.map((release) => (
          <div key={release.version} className={`flex flex-col gap-6 ${!release.isLatest ? "opacity-75 hover:opacity-100 transition-opacity" : ""}`}>
            <div className="flex items-center gap-4 border-b border-black/10 dark:border-white/10 pb-2">
              <span className="text-[18px] font-bold text-[var(--TextHighlight)] tracking-tight">{release.version}</span>
              <span className="text-[12px] font-medium text-[var(--TextMuted)] bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-md">{release.date}</span>
              {release.isLatest && (
                <span className="px-2 py-0.5 rounded-md bg-[var(--AccentPrimary)] text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                  最新版本
                </span>
              )}
            </div>

            <div className="flex flex-col gap-8">
              {release.sections.map((section) => (
                <div key={section.title} className="flex flex-col gap-3">
                  <h3 className="text-[14px] font-semibold text-[var(--TextHighlight)]">{section.title}</h3>
                  {section.description && (
                    <div className="text-[13px] text-[var(--TextPrimary)] leading-relaxed opacity-90 whitespace-pre-line">
                      {section.description}
                    </div>
                  )}
                  {section.items && section.items.length > 0 && (
                    <ul className="flex flex-col gap-2.5 text-[13px] text-[var(--TextPrimary)] leading-relaxed">
                      {section.items.map((item, idx) => (
                        <li key={idx} className="flex gap-3">
                          <span className={release.isLatest ? "text-[var(--AccentPrimary)]" : "text-[var(--TextMuted)]"}>•</span>
                          <span className="opacity-90">{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </InternalPageLayout>
  );
}
