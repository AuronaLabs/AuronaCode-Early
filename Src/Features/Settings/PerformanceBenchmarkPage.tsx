import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { FileSystemCommands } from "../../Foundation/IPC/FileSystemCommands";
import { PerformanceIPC } from "../../Foundation/IPC/PerformanceCommands";
import { formatDisplayVersion } from "../../Foundation/Release/ReleaseChannel";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Card } from "../../UI/Components/Card";
import { showToast } from "../../UI/Feedback/Toast";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import {
  type BenchmarkKind,
  type BenchmarkResult,
  type BenchmarkSnapshot,
  calculateCompositeScore,
  compareSemanticVersionsDescending,
  environmentKey,
  type LeaderboardEntry,
  normalizeHistory,
  PERFORMANCE_PROFILE,
  type PerformanceEnvironment,
  type PerformanceHistoryFile,
  type StartupMetrics,
  snapshotComparabilityKey,
} from "./PerformanceBenchmarkModel";

const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 9;
const IPC_WARMUP_RUNS = 24;
const IPC_SAMPLE_RUNS = 120;
const UI_WARMUP_FRAMES = 12;
const UI_SAMPLE_FRAMES = 90;
const FS_SAMPLE_COUNT = 320;
const FS_SAMPLE_BYTES = 4_096;
const SEARCH_SAMPLE_COUNT = 256;
const ENCODING_SAMPLE_LINES = 12_000;
const BENCHMARKS: { id: BenchmarkKind; labelKey: I18nKey; descriptionKey: I18nKey }[] = [
  {
    id: "ipc",
    labelKey: "performance.benchmarks.ipc.label",
    descriptionKey: "performance.benchmarks.ipc.description",
  },
  {
    id: "ui",
    labelKey: "performance.benchmarks.ui.label",
    descriptionKey: "performance.benchmarks.ui.description",
  },
  {
    id: "filesystem",
    labelKey: "performance.benchmarks.filesystem.label",
    descriptionKey: "performance.benchmarks.filesystem.description",
  },
  {
    id: "editor",
    labelKey: "performance.benchmarks.editor.label",
    descriptionKey: "performance.benchmarks.editor.description",
  },
  {
    id: "search",
    labelKey: "performance.benchmarks.search.label",
    descriptionKey: "performance.benchmarks.search.description",
  },
  {
    id: "encoding",
    labelKey: "performance.benchmarks.encoding.label",
    descriptionKey: "performance.benchmarks.encoding.description",
  },
  {
    id: "wasm",
    labelKey: "performance.benchmarks.wasm.label",
    descriptionKey: "performance.benchmarks.wasm.description",
  },
];
const formatDuration = (nanoseconds: number) =>
  nanoseconds < 1_000
    ? `${nanoseconds.toFixed(0)} ns`
    : nanoseconds < 1_000_000
      ? `${(nanoseconds / 1_000).toFixed(2)} μs`
      : nanoseconds < 1_000_000_000
        ? `${(nanoseconds / 1_000_000).toFixed(2)} ms`
        : `${(nanoseconds / 1_000_000_000).toFixed(2)} s`;
const formatMemory = (bytes: number) =>
  bytes ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : "—";
const average = (values: number[]) =>
  values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
const percentile = (values: number[], point: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * point) - 1)] || 0;
};
const coefficientOfVariation = (values: number[]) => {
  const mean = average(values);
  return mean ? (Math.sqrt(average(values.map((value) => (value - mean) ** 2))) / mean) * 100 : 0;
};
const trimmedSamples = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
};
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const getResult = (snapshot: BenchmarkSnapshot, id: string) =>
  Object.values(snapshot.results)
    .flat()
    .find((result) => result?.id === id && result.status === "ok");

const aggregateSuites = (
  suites: BenchmarkResult[][],
  t: (key: I18nKey) => string,
): BenchmarkResult[] => {
  const grouped = new Map<string, BenchmarkResult[]>();
  for (const suite of suites)
    for (const result of suite) grouped.set(result.id, [...(grouped.get(result.id) ?? []), result]);
  return [...grouped.values()].map((samples) => {
    const first = samples[0];
    if (samples.some((sample) => sample.status === "error")) return first;
    const durations = samples.map((sample) => sample.durationNs);
    const stableDurations = trimmedSamples(durations);
    const statistics = {
      meanNs: average(durations),
      trimmedMeanNs: average(stableDurations),
      p95Ns: percentile(durations, 0.95),
      coefficientVariation: coefficientOfVariation(stableDurations),
    };
    return {
      ...first,
      durationNs: Math.round(statistics.trimmedMeanNs),
      value: average(trimmedSamples(samples.map((sample) => sample.value))),
      samplesNs: durations,
      statistics,
      details: `${first.details}${t("performance.details.aggregate")
        .replace("{count}", String(samples.length))
        .replace("{mean}", formatDuration(statistics.trimmedMeanNs))
        .replace("{median}", formatDuration(percentile(durations, 0.5)))
        .replace("{p95}", formatDuration(statistics.p95Ns))
        .replace("{cv}", statistics.coefficientVariation.toFixed(1))}`,
    };
  });
};

const formatResultDetails = (result: BenchmarkResult, t: (key: I18nKey) => string) => {
  const samplesNs = result.samplesNs ?? [];
  const minNs = samplesNs.length ? Math.min(...samplesNs) : 0;
  const p95Ns = result.statistics?.p95Ns ?? 0;
  const cv = result.statistics?.coefficientVariation ?? 0;
  const fill = (key: I18nKey) =>
    t(key)
      .replace("{runs}", String(IPC_SAMPLE_RUNS))
      .replace("{frames}", String(UI_SAMPLE_FRAMES))
      .replace("{count}", String(FS_SAMPLE_COUNT))
      .replace("{bytes}", String(FS_SAMPLE_BYTES))
      .replace("{files}", String(SEARCH_SAMPLE_COUNT))
      .replace("{matches}", String(Math.round(result.value)))
      .replace("{lines}", String(ENCODING_SAMPLE_LINES))
      .replace("{edits}", "500")
      .replace("{mean}", result.value.toFixed(3))
      .replace("{min}", (minNs / 1_000_000).toFixed(3))
      .replace("{p95}", (p95Ns / 1_000_000).toFixed(3))
      .replace("{cv}", cv.toFixed(1));
  switch (result.id) {
    case "ipc-roundtrip":
      return fill("performance.details.ipcRoundtrip");
    case "ui-frame-cadence":
      return fill("performance.details.uiFrameCadence");
    case "filesystem-create":
      return fill("performance.details.filesystemCreate");
    case "filesystem-metadata":
      return fill("performance.details.filesystemMetadata");
    case "filesystem-read":
      return fill("performance.details.filesystemRead");
    case "filesystem-write":
      return fill("performance.details.filesystemWrite");
    case "filesystem-enumerate":
      return fill("performance.details.filesystemEnumerate");
    case "filesystem-delete":
      return fill("performance.details.filesystemDelete");
    case "editor-create":
      return fill("performance.details.editorCreate");
    case "editor-insert":
      return fill("performance.details.editorInsert");
    case "editor-read-line":
      return fill("performance.details.editorReadLine");
    case "editor-snapshot":
      return fill("performance.details.editorSnapshot");
    case "editor-batch-edit":
      return fill("performance.details.editorBatchEdit");
    case "editor-delete":
      return fill("performance.details.editorDelete");
    case "editor-release":
      return fill("performance.details.editorRelease");
    case "search-content":
      return fill("performance.details.searchContent");
    case "encoding-char-scan":
      return fill("performance.details.encodingCharScan");
    case "encoding-utf16":
      return fill("performance.details.encodingUtf16");
    case "encoding-line-map":
      return fill("performance.details.encodingLineMap");
    default:
      return result.details;
  }
};

export function PerformanceBenchmarkPage() {
  const { t } = useLocale();
  const [environment, setEnvironment] = useState<PerformanceEnvironment | null>(null);
  const [startup, setStartup] = useState<StartupMetrics | null>(null);
  const [results, setResults] = useState<Partial<Record<BenchmarkKind, BenchmarkResult[]>>>({});
  const [history, setHistory] = useState<BenchmarkSnapshot[]>([]);
  const [_baseline, setBaseline] = useState<BenchmarkSnapshot | null>(null);
  const [runningKind, setRunningKind] = useState<BenchmarkKind | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [expandedKinds, setExpandedKinds] = useState<Set<BenchmarkKind>>(new Set());
  const cancellationRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);

  const toggleExpanded = useCallback((kind: BenchmarkKind) => {
    setExpandedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const benchmarkLabel = useCallback(
    (kind: BenchmarkKind) =>
      t(
        BENCHMARKS.find((benchmark) => benchmark.id === kind)?.labelKey ??
          "performance.benchmarks.ipc.label",
      ),
    [t],
  );

  const refreshContext = useCallback(async () => {
    const workspace = await WorkspaceStore.get().catch(() => ({ lastOpenedPath: undefined }));
    const [nextEnvironment, nextStartup, savedHistory] = await Promise.all([
      PerformanceIPC.getEnvironment<PerformanceEnvironment>(workspace.lastOpenedPath ?? null),
      PerformanceIPC.getStartupMetrics<StartupMetrics | null>(),
      PerformanceIPC.loadBaseline<PerformanceHistoryFile | BenchmarkSnapshot | null>(),
    ]);
    const normalized = normalizeHistory(savedHistory);
    setEnvironment(nextEnvironment);
    setStartup(nextStartup);
    setHistory(normalized.history);
    setBaseline(normalized.latest);
  }, []);

  useEffect(() => {
    void refreshContext().catch((error) =>
      showToast(t("performance.toast.envFailed").replace("{error}", String(error)), "error"),
    );
    return () => {
      cancellationRef.current += 1;
    };
  }, [refreshContext, t]);

  const runIpcBenchmark = useCallback(async (): Promise<BenchmarkResult[]> => {
    for (let index = 0; index < IPC_WARMUP_RUNS; index += 1) await PerformanceIPC.ping();
    const samples: number[] = [];
    for (let index = 0; index < IPC_SAMPLE_RUNS; index += 1) {
      const started = performance.now();
      await PerformanceIPC.ping();
      samples.push(performance.now() - started);
    }
    const mean = average(samples);
    const samplesNs = samples.map((sample) => Math.round(sample * 1_000_000));
    return [
      {
        id: "ipc-roundtrip",
        name: "前端至 Rust 往返",
        durationNs: Math.round(mean * 1_000_000),
        value: mean,
        unit: "ms",
        status: "ok",
        details: t("performance.details.ipcRoundtrip")
          .replace("{runs}", String(IPC_SAMPLE_RUNS))
          .replace("{mean}", mean.toFixed(3))
          .replace("{min}", Math.min(...samples).toFixed(3))
          .replace("{p95}", percentile(samples, 0.95).toFixed(3))
          .replace("{cv}", coefficientOfVariation(samples).toFixed(1)),
        samplesNs,
        statistics: {
          meanNs: average(samplesNs),
          trimmedMeanNs: average(trimmedSamples(samplesNs)),
          p95Ns: percentile(samplesNs, 0.95),
          coefficientVariation: coefficientOfVariation(trimmedSamples(samplesNs)),
        },
      },
    ];
  }, [t]);

  const runUiBenchmark = useCallback(async (): Promise<BenchmarkResult[]> => {
    for (let index = 0; index < UI_WARMUP_FRAMES; index += 1) await frame();
    let previous = await frame();
    const samples: number[] = [];
    for (let index = 0; index < UI_SAMPLE_FRAMES; index += 1) {
      const current = await frame();
      samples.push(current - previous);
      previous = current;
    }
    const mean = average(samples);
    const samplesNs = samples.map((sample) => Math.round(sample * 1_000_000));
    return [
      {
        id: "ui-frame-cadence",
        name: "主线程帧间隔",
        durationNs: Math.round(mean * 1_000_000),
        value: mean,
        unit: "ms",
        status: "ok",
        details: t("performance.details.uiFrameCadence")
          .replace("{frames}", String(UI_SAMPLE_FRAMES))
          .replace("{mean}", mean.toFixed(2))
          .replace("{min}", Math.min(...samples).toFixed(2))
          .replace("{p95}", percentile(samples, 0.95).toFixed(2))
          .replace("{cv}", coefficientOfVariation(samples).toFixed(1)),
        samplesNs,
        statistics: {
          meanNs: average(samplesNs),
          trimmedMeanNs: average(trimmedSamples(samplesNs)),
          p95Ns: percentile(samplesNs, 0.95),
          coefficientVariation: coefficientOfVariation(trimmedSamples(samplesNs)),
        },
      },
    ];
  }, [t]);

  const runBenchmark = useCallback(
    async (kind: BenchmarkKind, token: number) => {
      setRunningKind(kind);
      try {
        const execute = () =>
          kind === "ipc"
            ? runIpcBenchmark()
            : kind === "ui"
              ? runUiBenchmark()
              : PerformanceIPC.runBenchmark<BenchmarkResult[]>(kind, `${token}`);
        const sampleRuns = kind === "ipc" || kind === "ui" ? 1 : SAMPLE_RUNS;
        if (sampleRuns > 1) for (let index = 0; index < WARMUP_RUNS; index += 1) await execute();
        if (cancellationRef.current !== token) return false;
        const samples: BenchmarkResult[][] = [];
        for (let index = 0; index < sampleRuns; index += 1) {
          samples.push(await execute());
          if (cancellationRef.current !== token) return false;
        }
        setResults((current) => ({ ...current, [kind]: aggregateSuites(samples, t) }));
        setLastRunAt(new Date().toISOString());
        return true;
      } catch (error) {
        if (cancellationRef.current !== token) return false;
        setResults((current) => ({
          ...current,
          [kind]: [
            {
              id: `${kind}-error`,
              name: benchmarkLabel(kind),
              durationNs: 0,
              value: 0,
              unit: "",
              status: "error",
              details: String(error),
            },
          ],
        }));
        showToast(
          t("performance.toast.benchmarkFailed").replace("{name}", benchmarkLabel(kind)),
          "error",
        );
        return false;
      } finally {
        if (cancellationRef.current === token) setRunningKind(null);
      }
    },
    [benchmarkLabel, runIpcBenchmark, runUiBenchmark, t],
  );

  const runOne = useCallback(
    async (kind: BenchmarkKind) => {
      if (runningKind || isRunningAll) return;
      const token = cancellationRef.current + 1;
      cancellationRef.current = token;
      activeRequestIdRef.current = `${token}`;
      await runBenchmark(kind, token);
    },
    [isRunningAll, runBenchmark, runningKind],
  );
  const runAll = useCallback(async () => {
    if (runningKind || isRunningAll) return;
    const token = cancellationRef.current + 1;
    cancellationRef.current = token;
    activeRequestIdRef.current = `${token}`;
    setIsRunningAll(true);
    for (const benchmark of BENCHMARKS)
      if (!(await runBenchmark(benchmark.id, token)) || cancellationRef.current !== token) break;
    if (cancellationRef.current === token) {
      setRunningKind(null);
      setIsRunningAll(false);
    }
  }, [isRunningAll, runBenchmark, runningKind]);
  const cancel = () => {
    const requestId = activeRequestIdRef.current;
    cancellationRef.current += 1;
    activeRequestIdRef.current = null;
    if (requestId) void PerformanceIPC.cancelBenchmark(requestId);
    setRunningKind(null);
    setIsRunningAll(false);
    showToast(t("performance.toast.cancelled"), "info");
  };

  const snapshot = useMemo<BenchmarkSnapshot>(
    () => ({
      schemaVersion: 3,
      profile: PERFORMANCE_PROFILE,
      comparabilityKey: environmentKey(environment),
      generatedAt: lastRunAt || new Date().toISOString(),
      environment,
      startup,
      results,
      sampleRuns: SAMPLE_RUNS,
      warmupRuns: WARMUP_RUNS,
    }),
    [environment, lastRunAt, results, startup],
  );
  const leaderboard = useMemo<LeaderboardEntry[]>(() => {
    const latestByVersion = new Map<string, BenchmarkSnapshot>();
    for (const item of history.filter(
      (item) => snapshotComparabilityKey(item) === environmentKey(environment),
    )) {
      const version = item.environment?.appVersion ?? t("performance.unknownVersion");
      const previous = latestByVersion.get(version);
      if (!previous || previous.generatedAt < item.generatedAt) {
        latestByVersion.set(version, item);
      }
    }
    const contenders = [...latestByVersion.values()];
    const fixedBaseline = contenders
      .filter((item) => item.environment?.appVersion === "0.2.10")
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
    const metricIds = [
      ...new Set(
        contenders.flatMap(
          (item) =>
            Object.values(item.results)
              .flat()
              .map((result) => result?.id)
              .filter(Boolean) as string[],
        ),
      ),
    ];
    return contenders
      .map((item) => {
        const ratios = metricIds.flatMap((id) => {
          const duration = getResult(item, id)?.durationNs;
          const candidateResult = getResult(item, id);
          const baselineDuration = fixedBaseline ? getResult(fixedBaseline, id)?.durationNs : null;
          const stable = (candidateResult?.statistics?.coefficientVariation ?? 0) <= 15;
          return duration && baselineDuration && stable ? [baselineDuration / duration] : [];
        });
        const actualMetricsCount = Object.values(item.results)
          .flat()
          .filter((r) => r && r.status === "ok").length;
        const finalScore =
          ratios.length > 0
            ? Math.exp(average(ratios.map((ratio) => Math.log(ratio)))) * 100
            : calculateCompositeScore(item);
        return {
          version: item.environment?.appVersion ?? t("performance.unknownVersion"),
          generatedAt: item.generatedAt,
          score: finalScore,
          measuredMetrics: actualMetricsCount > 0 ? actualMetricsCount : ratios.length,
        };
      })
      .sort((left, right) => compareSemanticVersionsDescending(left.version, right.version));
  }, [environment, history, t]);
  const comparisonBaseline = useMemo(
    () =>
      history
        .filter(
          (item) =>
            item.environment?.appVersion === "0.2.10" &&
            snapshotComparabilityKey(item) === environmentKey(environment),
        )
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0] ?? null,
    [environment, history],
  );

  const saveBaseline = async () => {
    if (Object.keys(results).length === 0) {
      showToast(t("performance.toast.runFirst"), "warning");
      return;
    }
    try {
      const nextHistory = [...history, snapshot].slice(-30);
      const payload: PerformanceHistoryFile = {
        schemaVersion: 3,
        latest: snapshot,
        history: nextHistory,
      };
      await PerformanceIPC.saveBaseline(payload);
      setHistory(nextHistory);
      setBaseline(snapshot);
      showToast(t("performance.toast.saved"), "success");
    } catch (error) {
      showToast(t("performance.toast.saveFailed").replace("{error}", String(error)), "error");
    }
  };
  const copySnapshot = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      showToast(t("performance.toast.copied"), "success");
    } catch (error) {
      showToast(t("performance.toast.copyFailed").replace("{error}", String(error)), "error");
    }
  };
  const exportSnapshot = async () => {
    try {
      const target = await FileSystemCommands.exportDialogFile(
        JSON.stringify(snapshot, null, 2),
        `aurona-performance-${new Date().toISOString().slice(0, 10)}.json`,
      );
      if (!target) return;
      showToast(t("performance.toast.exported"), "success");
    } catch (error) {
      showToast(t("performance.toast.exportFailed").replace("{error}", String(error)), "error");
    }
  };
  const deleteHistoryEntry = async (generatedAt: string) => {
    const nextHistory = history.filter((item) => item.generatedAt !== generatedAt);
    const nextLatest = nextHistory.at(-1) ?? null;
    const payload: PerformanceHistoryFile = {
      schemaVersion: 3,
      latest: nextLatest,
      history: nextHistory,
    };
    try {
      await PerformanceIPC.saveBaseline(payload);
      setHistory(nextHistory);
      setBaseline(nextLatest);
      showToast(t("performance.toast.deleted"), "success");
    } catch (error) {
      showToast(t("performance.toast.deleteFailed").replace("{error}", String(error)), "error");
    }
  };

  const currentVersion = environment?.appVersion;
  const currentScore = leaderboard.find((entry) => entry.version === currentVersion)?.score ?? null;
  const completedCount = BENCHMARKS.filter((benchmark) =>
    results[benchmark.id]?.some((result) => result.status === "ok"),
  ).length;
  const completedPct = Math.round((completedCount / BENCHMARKS.length) * 100);
  const ringValue = currentScore ?? completedPct;
  const ringMax = currentScore === null ? 100 : 150;
  const ringLabel =
    currentScore === null ? t("performance.completion") : t("performance.relativeScore");
  const ringText = currentScore === null ? `${completedPct}%` : currentScore.toFixed(0);

  return (
    <InternalPageLayout
      title={t("performance.title")}
      icon={<Icons.History size={24} />}
      maxWidth="max-w-5xl"
      headerRight={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refreshContext()}
            disabled={!!runningKind}
          >
            <Icons.Refresh size={14} /> {t("performance.refreshEnvironment")}
          </Button>
          {runningKind || isRunningAll ? (
            <Button variant="danger" size="sm" onClick={cancel}>
              <Icons.Close size={14} /> {t("performance.cancel")}
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => void runAll()}>
              <Icons.Play size={14} /> {t("performance.runAll")}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-10">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="flex items-center justify-center gap-5 p-5">
            <ScoreRing value={ringValue} max={ringMax} text={ringText} label={ringLabel} />
            <div className="flex flex-col gap-1.5 text-[12px]">
              <span className="text-[var(--color-text-muted)]">
                {t("performance.machineOverview")}
              </span>
              <span className="font-medium text-[var(--color-text-highlight)]">
                {t("performance.completedCount")
                  .replace("{done}", String(completedCount))
                  .replace("{total}", String(BENCHMARKS.length))}
              </span>
              {currentScore !== null && (
                <span className="text-[var(--color-text-muted)]">
                  {t("performance.relativeBaseline")}
                </span>
              )}
              <span className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                {runningKind
                  ? t("performance.runningLabel").replace("{name}", benchmarkLabel(runningKind))
                  : lastRunAt
                    ? t("performance.lastRunLabel").replace(
                        "{time}",
                        new Date(lastRunAt).toLocaleTimeString(),
                      )
                    : t("performance.neverRun")}
              </span>
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text-highlight)]">
              <Icons.Monitor size={17} /> {t("performance.environment")}
            </div>
            {environment ? (
              <div className="flex flex-wrap gap-2">
                {[
                  [t("performance.envVersion"), formatDisplayVersion(environment.appVersion)],
                  [t("performance.envSystem"), environment.operatingSystem],
                  [t("performance.envArchitecture"), environment.architecture],
                  [
                    t("performance.envCpu"),
                    `${environment.logicalCpuCores} ${t("performance.envCpuCores")}`,
                  ],
                  [t("performance.envMemory"), formatMemory(environment.availableMemoryBytes)],
                  [t("performance.envMode"), environment.runMode],
                ].map(([label, value]) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--material-surface)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-primary)]"
                  >
                    <span className="text-[var(--color-text-muted)]">{label}</span>
                    <b>{value}</b>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {t("performance.readingEnvironment")}
              </span>
            )}
            {startup && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  {t("performance.recentStartup")}
                </span>
                <span className="rounded-md bg-[var(--material-interactive-hover)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-highlight)]">
                  {t("performance.frontendMs").replace(
                    "{ms}",
                    startup.frontendBootstrapMs.toFixed(0),
                  )}
                </span>
                <span className="rounded-md bg-[var(--material-interactive-hover)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-highlight)]">
                  {t("performance.mainMs").replace("{ms}", startup.mainInteractiveMs.toFixed(0))}
                </span>
              </div>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {BENCHMARKS.map((benchmark) => {
            const suite = results[benchmark.id];
            const ok = suite?.find((result) => result.status === "ok");
            const failed = suite?.find((result) => result.status === "error");
            const previous =
              ok && comparisonBaseline ? getResult(comparisonBaseline, ok.id) : undefined;
            const delta =
              ok && previous && previous.durationNs > 0
                ? ((ok.durationNs - previous.durationNs) / previous.durationNs) * 100
                : null;
            return (
              <Card key={benchmark.id} className="flex min-w-0 flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                      <BenchmarkIcon id={benchmark.id} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-[14px] font-semibold text-[var(--color-text-highlight)]">
                        {t(benchmark.labelKey)}
                      </h2>
                      {ok ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[16px] font-bold text-[var(--color-text-highlight)]">
                            {formatDuration(ok.durationNs)}
                          </span>
                          {ok.statistics && (
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                                ok.statistics.coefficientVariation <= 15
                                  ? "bg-[var(--StatusSuccess)]/10 text-[var(--StatusSuccess)]"
                                  : "bg-[var(--StatusWarning)]/10 text-[var(--StatusWarning)]"
                              }`}
                            >
                              {t("performance.variation").replace(
                                "{pct}",
                                ok.statistics.coefficientVariation.toFixed(1),
                              )}
                            </span>
                          )}
                          {delta !== null && (
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                                delta > 5
                                  ? "bg-[var(--StatusWarning)]/10 text-[var(--StatusWarning)]"
                                  : delta < -5
                                    ? "bg-[var(--StatusSuccess)]/10 text-[var(--StatusSuccess)]"
                                    : "bg-[var(--material-interactive-hover)] text-[var(--color-text-muted)]"
                              }`}
                            >
                              {delta > 0 ? "+" : ""}
                              {delta.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      ) : failed ? (
                        <span className="text-[12px] text-[var(--DiagError)]">
                          {t("performance.testFailed")}
                        </span>
                      ) : (
                        <span className="text-[12px] text-[var(--color-text-muted)]">
                          {t("performance.notRun")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    className="shrink-0"
                    variant="secondary"
                    size="sm"
                    onClick={() => void runOne(benchmark.id)}
                    disabled={!!runningKind || isRunningAll}
                  >
                    {runningKind === benchmark.id ? (
                      <Icons.Refresh size={13} className="animate-spin" />
                    ) : (
                      <Icons.Play size={13} />
                    )}
                    {runningKind === benchmark.id ? t("performance.running") : t("performance.run")}
                  </Button>
                </div>
                {ok && (
                  <Tooltip content={formatResultDetails(ok, t)} placement="top">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--material-surface)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-accent)]/70"
                        style={{
                          width: `${Math.min(100, Math.max(14, 100 / (ok.durationNs / 1_000_000 + 0.6)))}%`,
                        }}
                      />
                    </div>
                  </Tooltip>
                )}
                <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {ok?.statistics
                      ? t("performance.trimmedAverage").replace(
                          "{count}",
                          String(ok.samplesNs?.length ?? 0),
                        )
                      : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(benchmark.id)}
                    className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent)] transition-opacity hover:opacity-80"
                  >
                    <Icons.ChevronRight
                      size={13}
                      stroke={2}
                      className={`transition-transform duration-150 ${expandedKinds.has(benchmark.id) ? "rotate-90" : ""}`}
                    />
                    {expandedKinds.has(benchmark.id)
                      ? t("performance.collapseDetails")
                      : t("performance.viewDetails")}
                  </button>
                </div>
                {expandedKinds.has(benchmark.id) && suite && suite.length > 0 && (
                  <BenchmarkDetail kind={benchmark.id} results={suite} />
                )}
              </Card>
            );
          })}
        </div>

        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--color-text-highlight)]">
                {t("performance.leaderboard")}
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                {t("performance.leaderboardHint")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void saveBaseline()}
                disabled={!Object.keys(results).length || !!runningKind}
              >
                {t("performance.saveRecord")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copySnapshot()}
                disabled={!Object.keys(results).length}
              >
                {t("performance.copyJson")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void exportSnapshot()}
                disabled={!Object.keys(results).length}
              >
                <Icons.Download size={14} /> {t("performance.export")}
              </Button>
            </div>
          </div>
          {leaderboard.length ? (
            <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
              {leaderboard.map((entry) => (
                <div
                  key={`${entry.version}-${entry.generatedAt}`}
                  className="flex items-center gap-4 border-b border-[var(--border-subtle)] px-3 py-2.5 text-[12px] last:border-b-0"
                >
                  <b className="w-24 shrink-0 text-[var(--color-text-primary)]">
                    {formatDisplayVersion(entry.version)}
                  </b>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--material-surface)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)]/70"
                      style={{
                        width: `${entry.score === null ? 0 : Math.min(100, (entry.score / 150) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-[var(--color-text-highlight)]">
                    {entry.score === null
                      ? t("performance.metricsCount").replace(
                          "{count}",
                          String(entry.measuredMetrics),
                        )
                      : entry.score.toFixed(0)}
                  </span>
                  <span className="hidden w-28 shrink-0 text-right text-[10px] text-[var(--color-text-muted)] sm:block">
                    {new Date(entry.generatedAt).toLocaleDateString()}
                  </span>
                  <Tooltip content={t("performance.deleteRecord")} placement="top">
                    <button
                      type="button"
                      aria-label={t("performance.deleteRecord")}
                      disabled={!!runningKind}
                      onClick={() => void deleteHistoryEntry(entry.generatedAt)}
                      className="shrink-0 rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--DiagError)] disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Icons.Trash size={13} />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("performance.leaderboardEmpty")}
            </span>
          )}
        </Card>
      </div>
    </InternalPageLayout>
  );
}

function ScoreRing({
  value,
  max,
  text,
  label,
}: {
  value: number;
  max: number;
  text: string;
  label: string;
}) {
  const size = 104;
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        role="img"
        aria-label={`${label}：${text}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--material-surface)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          style={{ transition: "stroke-dashoffset 500ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-mono text-[22px] font-bold leading-none text-[var(--color-text-highlight)]">
            {text}
          </div>
          <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">{label}</div>
        </div>
      </div>
    </div>
  );
}

function BenchmarkIcon({ id }: { id: BenchmarkKind }) {
  switch (id) {
    case "ipc":
      return <Icons.Refresh size={18} />;
    case "ui":
      return <Icons.Monitor size={18} />;
    case "filesystem":
      return <Icons.Folder size={18} />;
    case "editor":
      return <Icons.FileCode size={18} />;
    case "search":
      return <Icons.Search size={18} />;
    case "encoding":
      return <Icons.Typography size={18} />;
    case "wasm":
      return <Icons.Extensions size={18} />;
  }
}

function BenchmarkDetail({ kind, results }: { kind: BenchmarkKind; results: BenchmarkResult[] }) {
  const { t } = useLocale();
  const primary = results[0];
  if (!primary) return null;

  const samples = primary.samplesNs ?? [];
  const statistics = primary.statistics;

  // 单项统计直方图呈现（主要针对 IPC / UI）
  if (statistics && samples.length >= 2) {
    const sorted = [...samples].sort((left, right) => left - right);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    const bucketCount = 14;
    const range = Math.max(max - min, 1);
    const counts = new Array<number>(bucketCount).fill(0);
    for (const sample of samples) {
      const index = Math.min(bucketCount - 1, Math.floor(((sample - min) / range) * bucketCount));
      counts[index] += 1;
    }
    const maxCount = Math.max(...counts, 1);
    const buckets = counts.map((count, index) => ({
      id: `bar-${(min + (index * range) / bucketCount).toFixed(0)}`,
      count,
    }));

    return (
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)] p-3">
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          {[
            [
              t("performance.detailSamples"),
              `${samples.length} ${t("performance.detailSamplesUnit")}`,
            ],
            [t("performance.detailP50"), formatDuration(p50)],
            [t("performance.detailP95"), formatDuration(p95)],
            [t("performance.detailMin"), formatDuration(min)],
            [t("performance.detailMax"), formatDuration(max)],
            [t("performance.detailVariation"), `${statistics.coefficientVariation.toFixed(1)}%`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-[var(--material-panel)] px-2.5 py-2">
              <div className="text-[10px] text-[var(--color-text-muted)]">{label}</div>
              <div className="mt-0.5 font-mono text-[12px] font-semibold text-[var(--color-text-highlight)]">
                {value}
              </div>
            </div>
          ))}
        </div>
        <div className="flex h-16 items-end gap-1 px-1">
          {buckets.map((bucket) => (
            <div
              key={bucket.id}
              className="flex-1 rounded-t-sm bg-[var(--color-accent)]/60 transition-all hover:bg-[var(--color-accent)]"
              style={{ height: `${Math.max(6, (bucket.count / maxCount) * 100)}%` }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--material-panel)] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
          <span className="text-[var(--color-accent)]">
            <BenchmarkIcon id={kind} />
          </span>
          <span className="flex-1 leading-relaxed">{formatResultDetails(primary, t)}</span>
        </div>
      </div>
    );
  }

  // 多子项指标卡片呈现（针对 FS, Editor, Search, Encoding, WASM 等）
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)] p-3">
      <div className="grid gap-1.5">
        {results.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-lg bg-[var(--material-panel)] px-3 py-2 text-[11px]"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[var(--color-accent)] shrink-0">
                <BenchmarkIcon id={kind} />
              </span>
              <span className="font-medium text-[var(--color-text-highlight)] truncate">
                {item.name || item.id}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0 font-mono">
              <span className="text-[var(--color-text-primary)]">
                {item.value.toFixed(item.unit === "ops/s" ? 0 : 2)} {item.unit}
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {formatDuration(item.durationNs)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
