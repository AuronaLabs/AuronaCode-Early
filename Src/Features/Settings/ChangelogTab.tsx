import { useMemo } from "react";
import { useLocale } from "../../Foundation/I18n";
import {
  compareAuronaVersions,
  formatDisplayVersion,
  parseAuronaVersion,
} from "../../Foundation/Release/ReleaseChannel";
import { Badge } from "../../UI/Components/Badge";
import { Card } from "../../UI/Components/Card";
import { Input } from "../../UI/Components/Input";
import { useRetainedViewState } from "../../UI/Core/ViewState";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { CHANGELOG_DATA, type ChangelogEntry } from "./ChangelogData";

const parseMarkdownBold = (text: string) => {
  if (!text) return null;
  return text.split(/(\*\*.*?\*\*)/g).map((part) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`strong-${part}`} className="font-bold text-[var(--color-text-highlight)]">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
};

/** Keep the history easy to scan by grouping every patch under 0.1.x, 0.2.x, etc. */
export const versionFamilyId = (version: string) => {
  const parsed = parseAuronaVersion(version);
  return `${parsed.major}.${parsed.minor}`;
};

interface VersionFamily {
  id: string;
  label: string;
  releases: ChangelogEntry[];
}

function ReleaseSections({ release }: { release: ChangelogEntry }) {
  if (release.sections.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 border-t border-[var(--border-subtle)] px-5 py-5 lg:grid-cols-2">
      {release.sections.map((section) => (
        <section key={section.title} className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-control bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
              <Icons.Sparkles size={15} stroke={1.8} />
            </span>
            <h3 className="text-[13px] font-bold tracking-wide text-[var(--color-text-highlight)]">
              {section.title}
            </h3>
          </div>
          {section.description && (
            <p className="whitespace-pre-line text-[13px] leading-7 text-[var(--color-text-primary)]">
              {parseMarkdownBold(section.description)}
            </p>
          )}
          {section.items && section.items.length > 0 && (
            <ul className="flex flex-col gap-2">
              {section.items.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 text-[13px] leading-6 text-[var(--color-text-primary)]"
                >
                  <span className="mt-[10px] size-1 shrink-0 rounded-full bg-[var(--color-accent)] opacity-70" />
                  <span>{parseMarkdownBold(item)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function ChangelogTab() {
  const { t } = useLocale();
  const families = useMemo<VersionFamily[]>(() => {
    const buckets = new Map<string, ChangelogEntry[]>();
    for (const release of CHANGELOG_DATA) {
      const id = versionFamilyId(release.version);
      buckets.set(id, [...(buckets.get(id) ?? []), release]);
    }
    return Array.from(buckets.entries())
      .map(([id, releases]) => {
        const [major, minor] = id.split(".");
        return {
          id,
          label: `${major}.${minor}.x`,
          releases: releases.sort((a, b) => compareAuronaVersions(b.version, a.version)),
        };
      })
      .sort((a, b) => {
        const [aMajor, aMinor] = a.id.split(".").map(Number);
        const [bMajor, bMinor] = b.id.split(".").map(Number);
        return bMajor - aMajor || bMinor - aMinor;
      });
  }, []);

  const [selectedFamilyId, setSelectedFamilyId] = useRetainedViewState(
    "changelog.family",
    families[0]?.id ?? "",
  );
  const [searchQuery, setSearchQuery] = useRetainedViewState("changelog.query", "");
  const [expandedKeys, setExpandedKeys] = useRetainedViewState<Set<string>>(
    "changelog.expanded",
    () => new Set(CHANGELOG_DATA[0] ? [CHANGELOG_DATA[0].version] : []),
  );
  const selectedFamily = families.find((family) => family.id === selectedFamilyId) ?? families[0];
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matchesRelease = (release: ChangelogEntry) => {
    if (!normalizedQuery) return true;
    const text = [
      release.version,
      formatDisplayVersion(release.version),
      release.date,
      release.isUnreleased ? t("changelog.unreleased") : "",
      release.summary ?? "",
      ...release.sections.flatMap((section) => [
        section.title,
        section.description ?? "",
        ...(section.items ?? []),
      ]),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return text.includes(normalizedQuery);
  };
  const visibleFamilies = normalizedQuery
    ? families
        .map((family) => ({ ...family, releases: family.releases.filter(matchesRelease) }))
        .filter((family) => family.releases.length > 0)
    : selectedFamily
      ? [selectedFamily]
      : [];
  const visibleReleases = visibleFamilies.flatMap((family) => family.releases);

  const toggleKey = (version: string) => {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };
  const handleFamilyChange = (id: string) => {
    setSelectedFamilyId(id);
    const family = families.find((item) => item.id === id);
    setExpandedKeys(new Set(family?.releases[0] ? [family.releases[0].version] : []));
  };
  const expandIndicator = (expanded: boolean) => (
    <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-muted)]">
      {expanded ? t("changelog.collapse") : t("changelog.expand")}
      <Icons.ChevronDown
        size={17}
        stroke={2}
        className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
      />
    </span>
  );
  const headerMeta = (release: ChangelogEntry) => (
    <span className="flex min-w-0 flex-wrap items-center gap-2.5">
      <span
        className="text-[19px] font-bold tracking-tight text-[var(--color-text-highlight)]"
        style={{ fontFamily: "var(--font-mono, monospace)" }}
      >
        {formatDisplayVersion(release.version)}
      </span>
      <span className="rounded-control border border-[var(--border-subtle)] bg-[var(--material-panel)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--color-text-muted)]">
        {release.isUnreleased ? t("changelog.unreleased") : release.date}
      </span>
      {release.isLatest && !release.isUnreleased && <Badge>{t("changelog.latest")}</Badge>}
    </span>
  );

  return (
    <InternalPageLayout
      title={t("changelog.title")}
      maxWidth="max-w-5xl"
      titleRight={
        <span className="text-[12px] text-[var(--color-text-muted)]">
          {t("changelog.releaseCount").replace("{count}", String(visibleReleases.length))}
        </span>
      }
      headerRight={
        <Input
          inputSize="md"
          className="w-full sm:w-64"
          icon={<Icons.Search size={15} stroke={1.8} />}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("changelog.searchPlaceholder")}
          aria-label={t("changelog.searchPlaceholder")}
        />
      }
      sidebar={
        families.length > 1 && (
          <Card className="flex flex-col gap-1 p-2" layer="base">
            <div className="px-3 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
              {t("changelog.versionLines")}
            </div>
            {families.map((family) => {
              const selected = family.id === selectedFamily?.id;
              return (
                <button
                  key={family.id}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => handleFamilyChange(family.id)}
                  className={`flex items-center justify-between rounded-control px-3 py-2.5 text-left text-[13px] transition-colors ${selected ? "bg-[var(--material-interactive-active)] font-semibold text-[var(--color-text-highlight)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"}`}
                >
                  <span>{family.label}</span>
                  <span className="text-[11px] tabular-nums text-[var(--color-text-muted)]">
                    {family.releases.length}
                  </span>
                </button>
              );
            })}
          </Card>
        )
      }
    >
      <div className="flex max-w-5xl flex-col gap-5 pb-12">
        {visibleReleases.length === 0 && (
          <Card
            className="flex flex-col items-center justify-center gap-2 p-12 text-center"
            layer="base"
          >
            <Icons.Search size={22} className="text-[var(--color-text-muted)]" />
            <p className="text-[13px] font-medium text-[var(--color-text-highlight)]">
              {t("changelog.noSearchResults")}
            </p>
            <button
              type="button"
              className="text-[12px] text-[var(--color-accent)] hover:underline"
              onClick={() => setSearchQuery("")}
            >
              {t("changelog.clearSearch")}
            </button>
          </Card>
        )}

        {visibleFamilies.map((family) => (
          <section key={family.id} className="flex flex-col gap-3">
            {normalizedQuery && (
              <h2 className="px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                {family.label}
              </h2>
            )}
            {family.releases.map((release) => {
              const expanded = expandedKeys.has(release.version);
              return (
                <Card
                  key={release.version}
                  className="flex flex-col overflow-hidden"
                  layer="raised"
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`changelog-${release.version}`}
                    onClick={() => toggleKey(release.version)}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--material-interactive-hover)]"
                  >
                    <span className="min-w-0 flex-1">
                      {headerMeta(release)}
                      {release.summary && (
                        <span
                          className={`mt-3 block whitespace-pre-line text-[13px] leading-7 text-[var(--color-text-primary)] ${expanded ? "" : "line-clamp-2"}`}
                        >
                          {parseMarkdownBold(release.summary)}
                        </span>
                      )}
                    </span>
                    {expandIndicator(expanded)}
                  </button>
                  {expanded && (
                    <div id={`changelog-${release.version}`}>
                      <ReleaseSections release={release} />
                    </div>
                  )}
                </Card>
              );
            })}
          </section>
        ))}
      </div>
    </InternalPageLayout>
  );
}
