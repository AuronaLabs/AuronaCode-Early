import { useMemo, useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import { formatDisplayVersion, parseAuronaVersion } from "../../Foundation/Release/ReleaseChannel";
import { Badge } from "../../UI/Components/Badge";
import { Card } from "../../UI/Components/Card";
import { FilterChips } from "../../UI/Components/FilterChips";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import { CHANGELOG_DATA, type ChangelogEntry } from "./ChangelogData";

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

/** 预发布版本的短标签，如 "Pioneer 6"；正式版返回 null */
const preReleaseLabel = (version: string): string | null => {
  const parsed = parseAuronaVersion(version);
  if (!parsed.isPreRelease || !parsed.preReleaseTag) return null;
  const tag = parsed.preReleaseTag.charAt(0).toUpperCase() + parsed.preReleaseTag.slice(1);
  return parsed.preReleaseIter !== undefined ? `${tag} ${parsed.preReleaseIter}` : tag;
};

/** 大版本族 ID：主版本.次版本，如 "0.4" */
const familyIdOf = (version: string) => {
  const parsed = parseAuronaVersion(version);
  return `${parsed.major}.${parsed.minor}`;
};

interface VersionFamily {
  id: string;
  /** 顶层菜单标签，如 "0.4.x" */
  label: string;
  /** 族内含预发布版本时，整族收敛为一张 "x.y.z Pioneer" 卡 + 卡内切换菜单 */
  isPioneerFamily: boolean;
  /** Pioneer 卡的固定标题，如 "0.4.0 Pioneer"；非 pioneer 族为 null */
  pioneerLabel: string | null;
  releases: ChangelogEntry[];
}

/** 分区网格：一条版本的 release notes 主体 */
function ReleaseSections({ release }: { release: ChangelogEntry }) {
  if (release.sections.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 border-t border-[var(--border-subtle)] p-4 lg:grid-cols-2">
      {release.sections.map((section) => (
        <GlassContainer key={section.title} layer="base" className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-control bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
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
  );
}

export function ChangelogTab() {
  const { t } = useLocale();

  // 按主次版本分组；CHANGELOG_DATA 本身按新到旧排列
  const families = useMemo<VersionFamily[]>(() => {
    const buckets = new Map<string, ChangelogEntry[]>();
    for (const release of CHANGELOG_DATA) {
      const id = familyIdOf(release.version);
      const bucket = buckets.get(id);
      if (bucket) bucket.push(release);
      else buckets.set(id, [release]);
    }
    return Array.from(buckets.entries()).map(([id, releases]) => {
      const parsed = parseAuronaVersion(releases[0].version);
      const isPioneerFamily = releases.some((release) => preReleaseLabel(release.version) !== null);
      return {
        id,
        label: `${id}.x`,
        isPioneerFamily,
        // Pioneer 卡标题固定为 "x.y.z Pioneer"，不含迭代号（迭代号由卡内菜单切换）
        pioneerLabel: isPioneerFamily
          ? `${parsed.major}.${parsed.minor}.${parsed.patch} ${
              (parsed.preReleaseTag ?? "").charAt(0).toUpperCase() +
              (parsed.preReleaseTag ?? "").slice(1)
            }`
          : null,
        releases,
      };
    });
  }, []);

  const pioneerFamily = families.find((family) => family.isPioneerFamily);
  const [selectedFamilyId, setSelectedFamilyId] = useState(families[0]?.id ?? "");
  const [pioneerVersion, setPioneerVersion] = useState(pioneerFamily?.releases[0]?.version ?? "");
  // 卡片展开/收缩：键为版本号（普通卡片）或族 ID（Pioneer 卡）
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    const first = CHANGELOG_DATA[0];
    if (!first) return new Set<string>();
    const family = families.find((item) => item.id === familyIdOf(first.version));
    return new Set(family?.isPioneerFamily ? [family.id] : [first.version]);
  });

  const selectedFamily = families.find((family) => family.id === selectedFamilyId) ?? families[0];
  const pioneerRelease =
    pioneerFamily?.releases.find((release) => release.version === pioneerVersion) ??
    pioneerFamily?.releases[0];

  const toggleKey = (key: string) => {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleFamilyChange = (id: string) => {
    setSelectedFamilyId(id);
    // 切换大版本族时重置展开状态：默认展开该族最新的一张卡
    const family = families.find((item) => item.id === id);
    setExpandedKeys(new Set(family?.isPioneerFamily ? [id] : [family?.releases[0]?.version ?? ""]));
  };

  /** 展开指示：标题行右侧的 展开/收起 文案与旋转箭头 */
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

  /** 卡头元信息行：渲染版本标题 + 日期 + 最新徽标（供普通卡与 Pioneer 卡复用） */
  const headerMeta = (title: string, release: ChangelogEntry) => (
    <span className="flex min-w-0 flex-wrap items-center gap-2.5">
      <span
        className="text-[20px] font-bold tracking-tight text-[var(--color-text-highlight)]"
        style={{ fontFamily: "'Righteous', sans-serif" }}
      >
        {title}
      </span>
      <span className="rounded-control border border-[var(--border-subtle)] bg-[var(--material-panel)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--color-text-muted)]">
        {release.date}
      </span>
      {release.isLatest && <Badge>{t("changelog.latest")}</Badge>}
    </span>
  );

  return (
    <InternalPageLayout title={t("changelog.title")} maxWidth="max-w-4xl">
      <div className="flex max-w-4xl flex-col gap-5 pb-12">
        {/* 顶层菜单：仅大版本族（0.4.x / 0.3.x / 0.2.x），不显示计数 */}
        {families.length > 1 && (
          <FilterChips
            size="md"
            ariaLabel={t("changelog.title")}
            value={selectedFamily?.id ?? ""}
            onChange={handleFamilyChange}
            items={families.map((family) => ({ id: family.id, label: family.label }))}
          />
        )}

        {/* Pioneer 合集卡：同代预发布版本收敛于一张卡，卡内菜单切换迭代 */}
        {selectedFamily?.isPioneerFamily && pioneerRelease && (
          <Card className="flex flex-col overflow-hidden">
            <div className="flex flex-col border-b border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => toggleKey(selectedFamily.id)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--material-interactive-hover)]"
              >
                {headerMeta(selectedFamily.pioneerLabel ?? "", pioneerRelease)}
                {expandIndicator(expandedKeys.has(selectedFamily.id))}
              </button>
              {expandedKeys.has(selectedFamily.id) && (
                <div className="px-5 pb-4">
                  <FilterChips
                    size="sm"
                    ariaLabel={t("changelog.versionPicker")}
                    value={pioneerRelease.version}
                    onChange={setPioneerVersion}
                    items={selectedFamily.releases.map((release) => ({
                      id: release.version,
                      label:
                        preReleaseLabel(release.version) ?? formatDisplayVersion(release.version),
                    }))}
                  />
                </div>
              )}
            </div>

            {expandedKeys.has(selectedFamily.id) && (
              <>
                {pioneerRelease.summary && (
                  <p className="whitespace-pre-line px-5 pb-5 pt-4 text-[13px] leading-relaxed text-[var(--color-text-primary)] opacity-90">
                    {parseMarkdownBold(pioneerRelease.summary)}
                  </p>
                )}
                <ReleaseSections release={pioneerRelease} />
              </>
            )}
          </Card>
        )}

        {/* 普通版本族：每个小版本独立一张可展开/收缩的卡片 */}
        {selectedFamily &&
          !selectedFamily.isPioneerFamily &&
          selectedFamily.releases.map((release) => {
            const expanded = expandedKeys.has(release.version);
            return (
              <Card key={release.version} className="flex flex-col overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleKey(release.version)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--material-interactive-hover)]"
                >
                  <span className="min-w-0 flex-1">
                    {headerMeta(formatDisplayVersion(release.version), release)}
                    {expanded && release.summary && (
                      <span className="mt-2 block whitespace-pre-line text-[13px] leading-relaxed text-[var(--color-text-primary)] opacity-90">
                        {parseMarkdownBold(release.summary)}
                      </span>
                    )}
                  </span>
                  {expandIndicator(expanded)}
                </button>
                {expanded && <ReleaseSections release={release} />}
              </Card>
            );
          })}
      </div>
    </InternalPageLayout>
  );
}
