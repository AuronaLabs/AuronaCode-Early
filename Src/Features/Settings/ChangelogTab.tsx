import { useMemo, useState } from "react";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { CHANGELOG_DATA } from "./ChangelogData";

const parseMarkdownBold = (text: string) => {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-bold text-[var(--TextHighlight)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
};

export function ChangelogTab() {
  const versionFamilies = useMemo(() => {
    const families = new Set<string>();
    CHANGELOG_DATA.forEach((release) => {
      const parts = release.version.split(".");
      if (parts.length >= 2) {
        families.add(`V${parts[0].replace("V", "")}.${parts[1]}.X`);
      }
    });
    return Array.from(families);
  }, []);

  const [selectedFamily, setSelectedFamily] = useState<string>(versionFamilies[0] || "All");

  const filteredData = useMemo(() => {
    return CHANGELOG_DATA.filter((release) => {
      const parts = release.version.split(".");
      const family = `V${parts[0].replace("V", "")}.${parts[1]}.X`;
      return family === selectedFamily;
    });
  }, [selectedFamily]);

  const pillSelector = <div className="hidden"></div>;

  return (
    <InternalPageLayout title="更新历史" maxWidth="max-w-4xl">
      <div className="flex flex-col gap-12 max-w-4xl pb-12">
        {filteredData.map((release) => (
          <div
            key={release.version}
            className={`flex flex-col gap-6 ${!release.isLatest ? "opacity-80" : ""}`}
          >
            <div className="flex items-center gap-4 border-b border-black/10 dark:border-[var(--GlassBorder)] pb-4">
              <span
                className="text-[24px] font-bold text-[var(--TextHighlight)] tracking-tight"
                style={{ fontFamily: "'Righteous', sans-serif" }}
              >
                {release.version}
              </span>
              <span className="text-[13px] font-medium text-[var(--TextMuted)] bg-black/5 dark:bg-white/5 px-3 py-1 rounded-lg border border-[var(--GlassBorder)]">
                {release.date}
              </span>
              {release.isLatest && (
                <span className="px-3 py-1 rounded-lg bg-[var(--AccentPrimary)] text-white text-[11px] font-bold tracking-widest shadow-sm">
                  最新版本
                </span>
              )}
            </div>

            {release.summary && (
              <div className="text-[14px] text-[var(--TextPrimary)] leading-relaxed opacity-90 whitespace-pre-line px-1">
                {parseMarkdownBold(release.summary)}
              </div>
            )}

            <div className="grid grid-cols-2 gap-5">
              {release.sections.map((section) => (
                <div
                  key={section.title}
                  className="frosted-glass p-6 rounded-2xl border border-[var(--GlassBorder)] flex flex-col gap-4"
                >
                  <div className="flex items-center gap-2 text-[var(--TextHighlight)]">
                    <Icons.Sparkles size={18} />
                    <h3 className="text-[15px] font-bold tracking-wide">{section.title}</h3>
                  </div>
                  {section.description && (
                    <div className="text-[13px] text-[var(--TextPrimary)] leading-relaxed opacity-90 whitespace-pre-line">
                      {parseMarkdownBold(section.description)}
                    </div>
                  )}
                  {section.items && section.items.length > 0 && (
                    <ul className="flex flex-col gap-3 text-[13px] text-[var(--TextPrimary)] leading-relaxed mt-2">
                      {section.items.map((item, idx) => (
                        <li key={idx} className="flex gap-3 items-start">
                          <span className="text-[var(--AccentPrimary)] mt-0.5 opacity-80">
                            <Icons.Check size={14} stroke={3} />
                          </span>
                          <span className="opacity-90 leading-relaxed">
                            {parseMarkdownBold(item)}
                          </span>
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
