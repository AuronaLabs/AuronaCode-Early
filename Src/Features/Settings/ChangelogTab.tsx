import { useMemo, useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import { Card } from "../../UI/Components/Card";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { CHANGELOG_DATA } from "./ChangelogData";

const parseMarkdownBold = (text: string) => {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`strong-${part}`} className="font-bold text-[var(--color-text-highlight)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
};

const familyOf = (version: string) => {
  const parts = version.split(".");
  return `V${parts[0].replace("V", "")}.${parts[1]}.X`;
};

export function ChangelogTab() {
  const { t } = useLocale();

  const versionFamilies = useMemo(() => {
    const families = new Set<string>();
    CHANGELOG_DATA.forEach((release) => {
      families.add(familyOf(release.version));
    });
    return Array.from(families);
  }, []);

  const [selectedFamily, setSelectedFamily] = useState<string>(versionFamilies[0] || "All");
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(
    () =>
      new Set(
        CHANGELOG_DATA.filter((release) => release.isLatest).map((release) => release.version),
      ),
  );

  const filteredData = useMemo(() => {
    return CHANGELOG_DATA.filter((release) => familyOf(release.version) === selectedFamily);
  }, [selectedFamily]);

  const selectFamily = (family: string) => {
    setSelectedFamily(family);
    const first = CHANGELOG_DATA.find((release) => familyOf(release.version) === family);
    setExpandedVersions(new Set(first ? [first.version] : []));
  };

  const toggleVersion = (version: string) => {
    setExpandedVersions((previous) => {
      const next = new Set(previous);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  return (
    <InternalPageLayout title={t("changelog.title")} maxWidth="max-w-4xl">
      <div className="flex max-w-4xl flex-col gap-6 pb-12">
        <div className="flex flex-wrap items-center gap-2">
          {versionFamilies.map((family) => (
            <button
              key={family}
              type="button"
              onClick={() => selectFamily(family)}
              className={`rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors ${
                family === selectedFamily
                  ? "border-transparent bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                  : "border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {family}
            </button>
          ))}
        </div>

        {filteredData.map((release) => {
          const expanded = expandedVersions.has(release.version);
          return (
            <Card key={release.version} className="flex flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => toggleVersion(release.version)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--material-interactive-hover)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2.5">
                    <span
                      className="text-[20px] font-bold tracking-tight text-[var(--color-text-highlight)]"
                      style={{ fontFamily: "'Righteous', sans-serif" }}
                    >
                      {release.version}
                    </span>
                    <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--material-panel)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--color-text-muted)]">
                      {release.date}
                    </span>
                    {release.isLatest && (
                      <span className="rounded-lg bg-[var(--color-accent)] px-2.5 py-0.5 text-[11px] font-bold tracking-widest text-white">
                        {t("changelog.latest")}
                      </span>
                    )}
                  </span>
                  {expanded && release.summary && (
                    <span className="mt-2 block whitespace-pre-line text-[13px] leading-relaxed text-[var(--color-text-primary)] opacity-90">
                      {parseMarkdownBold(release.summary)}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-muted)]">
                  {expanded ? t("changelog.collapse") : t("changelog.expand")}
                  <Icons.ChevronDown
                    size={17}
                    stroke={2}
                    className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                  />
                </span>
              </button>

              {expanded && (
                <div className="grid grid-cols-1 gap-4 border-t border-[var(--border-subtle)] p-4 lg:grid-cols-2">
                  {release.sections.map((section) => (
                    <GlassContainer
                      key={section.title}
                      layer="base"
                      className="flex flex-col gap-3 p-5"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                          <Icons.Sparkles size={16} stroke={1.8} />
                        </span>
                        <h3 className="text-[14px] font-bold tracking-wide text-[var(--color-text-highlight)]">
                          {section.title}
                        </h3>
                      </div>
                      {section.description && (
                        <p className="whitespace-pre-line text-[13px] leading-relaxed text-[var(--color-text-primary)] opacity-90">
                          {parseMarkdownBold(section.description)}
                        </p>
                      )}
                      {section.items && section.items.length > 0 && (
                        <ul className="flex flex-col gap-2.5">
                          {section.items.map((item) => (
                            <li
                              key={item}
                              className="flex items-start gap-2.5 text-[13px] leading-relaxed text-[var(--color-text-primary)]"
                            >
                              <span className="mt-[7px] size-[5px] shrink-0 rounded-full bg-[var(--color-accent)] opacity-80" />
                              <span className="opacity-90">{parseMarkdownBold(item)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </GlassContainer>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </InternalPageLayout>
  );
}
