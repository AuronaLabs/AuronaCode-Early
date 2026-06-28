import {
  IconCommand,
  IconGitBranch,
  IconPlayerPlay,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";

export function TopCommandBar() {
  return (
    <header className="flex h-[76px] shrink-0 items-center gap-4 border-b border-white/8 bg-[var(--ColorTopbar)] px-6 backdrop-blur">
      <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.045] px-4 py-3">
        <IconSearch className="shrink-0 text-[var(--TextMuted)]" size={20} stroke={1.8} />
        <span className="truncate text-sm text-[var(--ColorSubtle)]">Search project, ask Agent, or jump to a Git story</span>
        <kbd className="ml-auto flex shrink-0 items-center gap-1 rounded-[10px] border border-white/10 bg-black/20 px-2 py-1 text-xs text-[var(--TextMuted)]">
          <IconCommand size={13} /> K
        </kbd>
      </div>

      <button
        className="flex h-11 items-center gap-2 rounded-[15px] border border-white/10 bg-white/[0.045] px-4 text-sm text-[var(--ColorSubtle)] transition hover:bg-white/10 hover:text-white"
        type="button"
      >
        <IconGitBranch size={18} stroke={1.8} />
        feature/git-story
      </button>

      <button
        className="grid h-11 w-11 place-items-center rounded-[15px] bg-[var(--AccentPrimary)] text-[var(--AccentText)] shadow-lg shadow-cyan-950/30 transition hover:brightness-110"
        title="Run Focus Review"
        type="button"
      >
        <IconPlayerPlay size={19} stroke={1.9} />
      </button>

      <button
        className="grid h-11 w-11 place-items-center rounded-[15px] border border-white/10 bg-white/[0.045] text-[var(--ColorSubtle)] transition hover:bg-white/10 hover:text-white"
        title="Agent Context"
        type="button"
      >
        <IconSparkles size={19} stroke={1.8} />
      </button>
    </header>
  );
}
