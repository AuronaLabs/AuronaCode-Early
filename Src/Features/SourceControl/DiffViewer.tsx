import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitService } from "../../Core/Git";
import { WorkspaceService } from "../../Core/Workspace";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { EmptyState } from "../../UI/Components/EmptyState";
import { useViewActivity } from "../../UI/Core/ViewActivity";
import { useRetainedScroll, useRetainedViewState } from "../../UI/Core/ViewState";
import { showToast } from "../../UI/Feedback/Toast";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { alignDiffLines, type DiffLine, parseDiff, supportsHunkAction } from "./DiffModel";
import "./DiffViewer.css";

interface DiffViewerProps {
  diffTarget: string;
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function SplitDiff({
  lines,
  renderCell,
}: {
  lines: DiffLine[];
  renderCell: (line: DiffLine | null, side: "left" | "right") => ReactNode;
}) {
  const rows = useMemo(() => alignDiffLines(lines), [lines]);
  return (
    <div
      className="diff-code diff-code--split"
      style={{ gridTemplateRows: `repeat(${rows.length}, auto)` }}
    >
      {(["left", "right"] as const).map((side) => (
        <div className="aurona-scroll diff-code-pane" key={side}>
          {rows.map((row) => (
            <div
              className="diff-code-row"
              key={`${String(row.left?.leftLineNum)}:${String(row.right?.rightLineNum)}`}
            >
              {renderCell(row[side], side)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DiffViewer({ diffTarget }: DiffViewerProps) {
  const { t } = useLocale();
  const active = useViewActivity();
  const scroll = useRetainedScroll("diff.scroll");
  const [layout, setLayout] = useRetainedViewState<"split" | "unified">("diff.layout", "split");
  const [wrap, setWrap] = useRetainedViewState("diff.wrap", false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [rawDiff, setRawDiff] = useState("");
  const [busyHunk, setBusyHunk] = useState<number | null>(null);
  const [selectedHunk, setSelectedHunk] = useState(-1);
  const [compact, setCompact] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hunkRefs = useRef<(HTMLElement | null)[]>([]);
  const actionRef = useRef(false);
  const loadRequestRef = useRef(0);
  const workingTarget = diffTarget.match(/^working:(staged|unstaged):(.*)$/);
  const workingFile = workingTarget ? decodeTarget(workingTarget[2]) : null;
  const isStaged = workingTarget?.[1] === "staged";
  const parsed = useMemo(() => parseDiff(rawDiff), [rawDiff]);
  const { files, message } = parsed;
  const summary = useMemo(
    () =>
      files.reduce(
        (result, file) => ({
          additions: result.additions + file.additions,
          deletions: result.deletions + file.deletions,
          hunks: result.hunks + file.hunks.length,
        }),
        { additions: 0, deletions: 0, hunks: 0 },
      ),
    [files],
  );
  const canApply = Boolean(workingFile) && supportsHunkAction(rawDiff);
  const view = compact ? "unified" : layout;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < 640);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const loadDiff = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    setSelectedHunk(-1);
    try {
      await WorkspaceService.whenInitialized();
      if (requestId !== loadRequestRef.current) return;
      const path = WorkspaceService.getCurrent().primaryRoot;
      if (!path) {
        setRepoPath(null);
        setRawDiff("");
        return;
      }
      const result = workingFile
        ? await GitService.getDiff(path, workingFile, isStaged)
        : await GitService.getCommitDiff(path, diffTarget);
      if (
        requestId !== loadRequestRef.current ||
        path !== WorkspaceService.getCurrent().primaryRoot
      )
        return;
      setRepoPath(path);
      setRawDiff(result);
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(String(err));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [diffTarget, isStaged, workingFile]);

  useEffect(() => {
    if (!active) return;
    void loadDiff();
    const unsubscribe = EventBus.on("workspace:root-changed", () => void loadDiff());
    return () => {
      unsubscribe();
      loadRequestRef.current++;
    };
  }, [active, loadDiff]);

  const applyHunk = async (hunkIndex: number) => {
    if (!repoPath || !workingFile || actionRef.current) return;
    const reviewedRequest = loadRequestRef.current;
    actionRef.current = true;
    setBusyHunk(hunkIndex);
    try {
      await GitService.applyHunk(repoPath, workingFile, isStaged, hunkIndex, rawDiff);
      if (reviewedRequest === loadRequestRef.current) await loadDiff();
      const cache = await GitService.refresh(repoPath);
      if (cache?.repoPath === repoPath && WorkspaceService.getCurrent().primaryRoot === repoPath) {
        EventBus.emit("git:changes-count", cache.files.length);
      }
    } catch (err) {
      showToast(t("sourceControl.hunkFailed").replace("{message}", String(err)), "error");
      if (reviewedRequest === loadRequestRef.current) await loadDiff();
    } finally {
      actionRef.current = false;
      setBusyHunk(null);
    }
  };

  const jumpToHunk = (direction: number) => {
    if (!summary.hunks) return;
    const next =
      selectedHunk < 0
        ? direction > 0
          ? 0
          : summary.hunks - 1
        : (selectedHunk + direction + summary.hunks) % summary.hunks;
    setSelectedHunk(next);
    const element = hunkRefs.current[next];
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "center", behavior: "instant" });
  };

  const renderCell = (line: DiffLine | null, side: "left" | "right", unified = false) => (
    <div className={`diff-code-cell diff-code-cell--${line?.type ?? "empty"}`}>
      {unified && (
        <span className="diff-line-number" aria-hidden="true">
          {line?.leftLineNum}
        </span>
      )}
      <span className="diff-line-number" aria-hidden="true">
        {unified || side === "right" ? line?.rightLineNum : line?.leftLineNum}
      </span>
      <span className="diff-line-sign" aria-hidden="true">
        {line?.type === "addition" ? "+" : line?.type === "deletion" ? "−" : ""}
      </span>
      <code className="diff-code-text">{line?.content || " "}</code>
      {line?.noNewline && (
        <span className="diff-no-newline">{t("sourceControl.diffViewer.noNewline")}</span>
      )}
    </div>
  );

  let hunkOffset = 0;
  return (
    <div ref={rootRef} className={`diff-viewer${wrap ? " diff-viewer--wrap" : ""}`}>
      <header className="diff-toolbar">
        <div className="diff-heading">
          <Icons.GitCommit size={18} stroke={1.5} aria-hidden="true" />
          <div className="diff-heading-text">
            <h1>{workingFile ?? t("sourceControl.diffViewer.commitTitle")}</h1>
            <p>
              {workingFile
                ? isStaged
                  ? t("sourceControl.diffViewer.staged")
                  : t("sourceControl.diffViewer.unstaged")
                : diffTarget.slice(0, 8) + (message ? ` · ${message.split("\n")[0]}` : "")}
            </p>
          </div>
        </div>
        <div className="diff-toolbar-actions">
          <fieldset
            className="diff-layout-toggle"
            aria-label={t("sourceControl.diffViewer.layout")}
          >
            <button
              type="button"
              aria-pressed={view === "split"}
              disabled={compact}
              onClick={() => setLayout("split")}
            >
              {t("sourceControl.diffViewer.split")}
            </button>
            <button
              type="button"
              aria-pressed={view === "unified"}
              onClick={() => setLayout("unified")}
            >
              {t("sourceControl.diffViewer.unified")}
            </button>
          </fieldset>
          <Tooltip content={t("sourceControl.diffViewer.wrap")}>
            <button
              type="button"
              className="diff-icon-button"
              aria-label={t("sourceControl.diffViewer.wrap")}
              aria-pressed={wrap}
              onClick={() => setWrap((value) => !value)}
            >
              <Icons.Menu size={16} />
            </button>
          </Tooltip>
          <Tooltip content={t("sourceControl.refresh")}>
            <button
              type="button"
              className="diff-icon-button"
              aria-label={t("sourceControl.refresh")}
              disabled={loading || busyHunk !== null}
              onClick={() => void loadDiff()}
            >
              <Icons.Refresh size={16} />
            </button>
          </Tooltip>
        </div>
      </header>
      {!loading && !error && files.length > 0 && (
        <div className="diff-summary">
          <span>
            {t("sourceControl.diffViewer.fileCount").replace("{count}", String(files.length))}
          </span>
          <span className="diff-stat-added">+{summary.additions}</span>
          <span className="diff-stat-deleted">−{summary.deletions}</span>
          {summary.hunks > 0 && (
            <div className="diff-navigation">
              <span aria-live="polite">
                {selectedHunk < 0 ? "—" : selectedHunk + 1} / {summary.hunks}
              </span>
              <Tooltip content={t("sourceControl.diffViewer.previousChange")}>
                <button
                  type="button"
                  className="diff-icon-button"
                  aria-label={t("sourceControl.diffViewer.previousChange")}
                  onClick={() => jumpToHunk(-1)}
                >
                  <Icons.ArrowUp size={14} />
                </button>
              </Tooltip>
              <Tooltip content={t("sourceControl.diffViewer.nextChange")}>
                <button
                  type="button"
                  className="diff-icon-button"
                  aria-label={t("sourceControl.diffViewer.nextChange")}
                  onClick={() => jumpToHunk(1)}
                >
                  <Icons.ArrowDown size={14} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      )}
      <div
        {...scroll}
        key={loading ? "loading" : "content"}
        className="aurona-scroll diff-content"
        aria-busy={loading}
      >
        {loading ? (
          <div className="diff-state" role="status">
            <Icons.Refresh size={20} />
            {t("sourceControl.diffViewer.loading")}
          </div>
        ) : error ? (
          <div className="diff-state">
            <EmptyState
              icon={<Icons.AlertTriangle size={26} />}
              title={t("sourceControl.diffViewer.loadFailed")}
              description={error}
            />
            <button type="button" className="diff-text-button" onClick={() => void loadDiff()}>
              {t("sourceControl.diffViewer.retry")}
            </button>
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            icon={<Icons.FileCode size={27} stroke={1.5} />}
            title={t("sourceControl.diffViewer.empty")}
          />
        ) : (
          files.map((file) => {
            const fileOffset = hunkOffset;
            hunkOffset += file.hunks.length;
            const fileName =
              file.status === "renamed" || file.status === "copied"
                ? `${file.oldName} → ${file.newName}`
                : file.newName;
            return (
              <section className="diff-file" key={`${file.oldName}:${file.newName}`}>
                <header className="diff-file-header">
                  <Icons.FileCode size={16} stroke={1.5} aria-hidden="true" />
                  <h2>{fileName}</h2>
                  <span className="diff-file-status">
                    {t(`sourceControl.diffViewer.${file.status}`)}
                  </span>
                  <span className="diff-stat-added">+{file.additions}</span>
                  <span className="diff-stat-deleted">−{file.deletions}</span>
                </header>
                {file.binary || file.hunks.length === 0 ? (
                  <div className="diff-file-notice">
                    <Icons.Info size={18} stroke={1.5} />
                    <div>
                      <p>
                        {t(
                          file.binary
                            ? "sourceControl.diffViewer.binary"
                            : "sourceControl.diffViewer.metadataOnly",
                        )}
                      </p>
                      {file.metadata.length > 0 && <code>{file.metadata.join(" · ")}</code>}
                    </div>
                  </div>
                ) : (
                  <>
                    {view === "split" && (
                      <div className="diff-column-labels" aria-hidden="true">
                        <span>{t("sourceControl.diffViewer.before")}</span>
                        <span>{t("sourceControl.diffViewer.after")}</span>
                      </div>
                    )}
                    {file.hunks.map((hunk, hunkIndex) => {
                      const index = fileOffset + hunkIndex;
                      return (
                        <section
                          className="diff-hunk"
                          tabIndex={-1}
                          key={hunk.header}
                          ref={(element) => {
                            hunkRefs.current[index] = element;
                          }}
                          aria-label={hunk.header}
                          data-selected={selectedHunk === index || undefined}
                        >
                          <div className="diff-hunk-header">
                            <code>{hunk.header}</code>
                            {canApply && (
                              <button
                                type="button"
                                className="diff-text-button"
                                onClick={() => void applyHunk(hunkIndex)}
                                disabled={busyHunk !== null}
                              >
                                {busyHunk === hunkIndex ? (
                                  <Icons.Refresh size={13} />
                                ) : isStaged ? (
                                  <Icons.Minus size={13} />
                                ) : (
                                  <Icons.Plus size={13} />
                                )}
                                {isStaged
                                  ? t("sourceControl.unstageHunk")
                                  : t("sourceControl.stageHunk")}
                              </button>
                            )}
                          </div>
                          {view === "split" ? (
                            <SplitDiff lines={hunk.lines} renderCell={renderCell} />
                          ) : (
                            <div className="aurona-scroll diff-code diff-code--unified">
                              {hunk.lines.map((line) => (
                                <div
                                  className="diff-code-row"
                                  key={`${line.type}:${line.leftLineNum}:${line.rightLineNum}`}
                                >
                                  {renderCell(line, "right", true)}
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
