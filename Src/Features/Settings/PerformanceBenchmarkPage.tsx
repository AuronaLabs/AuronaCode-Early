import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSystemCommands } from "../../Foundation/IPC/FileSystemCommands";
import { PerformanceIPC } from "../../Foundation/IPC/PerformanceCommands";
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
const BENCHMARKS: { id: BenchmarkKind; label: string; description: string }[] = [
  {
    id: "ipc",
    label: "IPC 往返",
    description: "24 次预热后采样 120 次真实 Tauri 请求，包含 WebView 调度",
  },
  {
    id: "ui",
    label: "主线程帧调度",
    description: "连续采样 90 帧的 requestAnimationFrame 间隔，反映当前 UI 响应压力",
  },
  {
    id: "filesystem",
    label: "文件系统",
    description: "临时目录内创建、读取、覆写、元数据读取、遍历与删除 320 个文件",
  },
  {
    id: "editor",
    label: "编辑器内核",
    description: "使用 Rust Rope 执行文档创建、快照、局部读写和批量编辑",
  },
  { id: "search", label: "搜索能力", description: "对 256 个临时源码样本调用真实工作区搜索引擎" },
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
  bytes ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : "未提供";
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

const aggregateSuites = (suites: BenchmarkResult[][]): BenchmarkResult[] => {
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
      details: `${first.details} · ${samples.length} 轮去极值平均 ${formatDuration(statistics.trimmedMeanNs)} · 中位数 ${formatDuration(percentile(durations, 0.5))} · P95 ${formatDuration(statistics.p95Ns)} · 波动 ${statistics.coefficientVariation.toFixed(1)}%`,
    };
  });
};

export function PerformanceBenchmarkPage() {
  const [environment, setEnvironment] = useState<PerformanceEnvironment | null>(null);
  const [startup, setStartup] = useState<StartupMetrics | null>(null);
  const [results, setResults] = useState<Partial<Record<BenchmarkKind, BenchmarkResult[]>>>({});
  const [history, setHistory] = useState<BenchmarkSnapshot[]>([]);
  const [_baseline, setBaseline] = useState<BenchmarkSnapshot | null>(null);
  const [runningKind, setRunningKind] = useState<BenchmarkKind | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [expandedKind, setExpandedKind] = useState<BenchmarkKind | null>(null);
  const cancellationRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);

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
      showToast(`无法读取性能环境：${String(error)}`, "error"),
    );
    return () => {
      cancellationRef.current += 1;
    };
  }, [refreshContext]);

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
        details: `${IPC_SAMPLE_RUNS} 次 · 平均 ${mean.toFixed(3)} ms · 最小 ${Math.min(...samples).toFixed(3)} ms · P95 ${percentile(samples, 0.95).toFixed(3)} ms · 波动 ${coefficientOfVariation(samples).toFixed(1)}%`,
        samplesNs,
        statistics: {
          meanNs: average(samplesNs),
          trimmedMeanNs: average(trimmedSamples(samplesNs)),
          p95Ns: percentile(samplesNs, 0.95),
          coefficientVariation: coefficientOfVariation(trimmedSamples(samplesNs)),
        },
      },
    ];
  }, []);

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
        details: `${UI_SAMPLE_FRAMES} 帧 · 平均 ${mean.toFixed(2)} ms · 最小 ${Math.min(...samples).toFixed(2)} ms · P95 ${percentile(samples, 0.95).toFixed(2)} ms · 波动 ${coefficientOfVariation(samples).toFixed(1)}%`,
        samplesNs,
        statistics: {
          meanNs: average(samplesNs),
          trimmedMeanNs: average(trimmedSamples(samplesNs)),
          p95Ns: percentile(samplesNs, 0.95),
          coefficientVariation: coefficientOfVariation(trimmedSamples(samplesNs)),
        },
      },
    ];
  }, []);

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
        setResults((current) => ({ ...current, [kind]: aggregateSuites(samples) }));
        setLastRunAt(new Date().toISOString());
        return true;
      } catch (error) {
        if (cancellationRef.current !== token) return false;
        setResults((current) => ({
          ...current,
          [kind]: [
            {
              id: `${kind}-error`,
              name: BENCHMARKS.find((benchmark) => benchmark.id === kind)?.label || kind,
              durationNs: 0,
              value: 0,
              unit: "",
              status: "error",
              details: String(error),
            },
          ],
        }));
        showToast(
          `${BENCHMARKS.find((benchmark) => benchmark.id === kind)?.label || kind}测试失败`,
          "error",
        );
        return false;
      } finally {
        if (cancellationRef.current === token) setRunningKind(null);
      }
    },
    [runIpcBenchmark, runUiBenchmark],
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
    showToast("已停止后续采样；当前原子测试会安全结束并清理临时文件", "info");
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
      const version = item.environment?.appVersion ?? "未知版本";
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
        return {
          version: item.environment?.appVersion ?? "未知版本",
          generatedAt: item.generatedAt,
          score:
            ratios.length > 0
              ? Math.exp(average(ratios.map((ratio) => Math.log(ratio)))) * 100
              : null,
          measuredMetrics: ratios.length,
        };
      })
      .sort((left, right) => compareSemanticVersionsDescending(left.version, right.version));
  }, [environment, history]);
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
      showToast("请先完成至少一项性能测试", "warning");
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
      showToast("已保存本次性能记录，并加入本地版本排行榜", "success");
    } catch (error) {
      showToast(`保存性能记录失败：${String(error)}`, "error");
    }
  };
  const copySnapshot = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      showToast("性能结果 JSON 已复制", "success");
    } catch (error) {
      showToast(`复制性能结果失败：${String(error)}`, "error");
    }
  };
  const exportSnapshot = async () => {
    try {
      const target = await FileSystemCommands.exportDialogFile(
        JSON.stringify(snapshot, null, 2),
        `aurona-performance-${new Date().toISOString().slice(0, 10)}.json`,
      );
      if (!target) return;
      showToast("性能结果已导出", "success");
    } catch (error) {
      showToast(`导出性能结果失败：${String(error)}`, "error");
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
  const ringLabel = currentScore === null ? "完成度" : "相对得分";
  const ringText = currentScore === null ? `${completedPct}%` : currentScore.toFixed(0);

  return (
    <InternalPageLayout
      title="性能测试"
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
            <Icons.Refresh size={14} /> 刷新环境
          </Button>
          {runningKind || isRunningAll ? (
            <Button variant="danger" size="sm" onClick={cancel}>
              <Icons.Close size={14} /> 取消
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => void runAll()}>
              <Icons.Play size={14} /> 运行全部
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
              <span className="text-[var(--color-text-muted)]">本机性能概况</span>
              <span className="font-medium text-[var(--color-text-highlight)]">
                {completedCount}/{BENCHMARKS.length} 项完成
              </span>
              {currentScore !== null && (
                <span className="text-[var(--color-text-muted)]">相对 0.2.10 基线</span>
              )}
              <span className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                {runningKind
                  ? `正在运行：${BENCHMARKS.find((item) => item.id === runningKind)?.label}`
                  : lastRunAt
                    ? `最近运行 ${new Date(lastRunAt).toLocaleTimeString()}`
                    : "尚未运行测试"}
              </span>
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text-highlight)]">
              <Icons.Monitor size={17} /> 运行环境
            </div>
            {environment ? (
              <div className="flex flex-wrap gap-2">
                {[
                  ["版本", `v${environment.appVersion}`],
                  ["系统", environment.operatingSystem],
                  ["架构", environment.architecture],
                  ["CPU", `${environment.logicalCpuCores} 核`],
                  ["内存", formatMemory(environment.availableMemoryBytes)],
                  ["模式", environment.runMode],
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
              <span className="text-[12px] text-[var(--color-text-muted)]">正在读取运行环境…</span>
            )}
            {startup && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
                <span className="text-[11px] text-[var(--color-text-muted)]">最近启动</span>
                <span className="rounded-md bg-[var(--material-interactive-hover)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-highlight)]">
                  前端 {startup.frontendBootstrapMs.toFixed(0)} ms
                </span>
                <span className="rounded-md bg-[var(--material-interactive-hover)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-highlight)]">
                  主界面 {startup.mainInteractiveMs.toFixed(0)} ms
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
                        {benchmark.label}
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
                                  ? "bg-emerald-500/10 text-emerald-500"
                                  : "bg-amber-500/10 text-amber-500"
                              }`}
                            >
                              波动 {ok.statistics.coefficientVariation.toFixed(1)}%
                            </span>
                          )}
                          {delta !== null && (
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                                delta > 5
                                  ? "bg-amber-500/10 text-amber-500"
                                  : delta < -5
                                    ? "bg-emerald-500/10 text-emerald-500"
                                    : "bg-[var(--material-interactive-hover)] text-[var(--color-text-muted)]"
                              }`}
                            >
                              {delta > 0 ? "+" : ""}
                              {delta.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      ) : failed ? (
                        <span className="text-[12px] text-[var(--DiagError)]">测试失败</span>
                      ) : (
                        <span className="text-[12px] text-[var(--color-text-muted)]">尚未运行</span>
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
                    {runningKind === benchmark.id ? "运行中" : "运行"}
                  </Button>
                </div>
                {ok && (
                  <Tooltip content={ok.details} placement="top">
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
                    {ok?.statistics ? `去极值平均 · ${ok.samplesNs?.length ?? 0} 个样本` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedKind((current) => (current === benchmark.id ? null : benchmark.id))
                    }
                    className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent)] transition-opacity hover:opacity-80"
                  >
                    <Icons.ChevronRight
                      size={13}
                      stroke={2}
                      className={`transition-transform duration-150 ${expandedKind === benchmark.id ? "rotate-90" : ""}`}
                    />
                    {expandedKind === benchmark.id ? "收起详情" : "查看详情"}
                  </button>
                </div>
                {expandedKind === benchmark.id && ok && <BenchmarkDetail result={ok} />}
              </Card>
            );
          })}
        </div>

        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--color-text-highlight)]">
                版本排行榜
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                仅比较本机保存的记录
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void saveBaseline()}
                disabled={!Object.keys(results).length || !!runningKind}
              >
                保存记录
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copySnapshot()}
                disabled={!Object.keys(results).length}
              >
                复制 JSON
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void exportSnapshot()}
                disabled={!Object.keys(results).length}
              >
                <Icons.Download size={14} /> 导出
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
                  <b className="w-16 shrink-0 text-[var(--color-text-primary)]">v{entry.version}</b>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--material-surface)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)]/70"
                      style={{
                        width: `${entry.score === null ? 0 : Math.min(100, (entry.score / 150) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-[var(--color-text-highlight)]">
                    {entry.score === null ? "—" : entry.score.toFixed(0)}
                  </span>
                  <span className="hidden w-28 shrink-0 text-right text-[10px] text-[var(--color-text-muted)] sm:block">
                    {new Date(entry.generatedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-[var(--color-text-muted)]">
              运行并保存一次测试后，这里会出现版本对比
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
  }
}

function BenchmarkDetail({ result }: { result: BenchmarkResult }) {
  const samples = result.samplesNs ?? [];
  const statistics = result.statistics;
  if (!statistics || samples.length < 2) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--material-surface)] p-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        {result.details}
      </div>
    );
  }
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
          ["样本", `${samples.length} 次`],
          ["P50", formatDuration(p50)],
          ["P95", formatDuration(p95)],
          ["最小", formatDuration(min)],
          ["最大", formatDuration(max)],
          ["波动", `${statistics.coefficientVariation.toFixed(1)}%`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-[var(--material-panel)] px-2.5 py-2">
            <div className="text-[10px] text-[var(--color-text-muted)]">{label}</div>
            <div className="mt-0.5 font-mono text-[12px] font-semibold text-[var(--color-text-highlight)]">
              {value}
            </div>
          </div>
        ))}
      </div>
      <div className="flex h-16 items-end gap-1">
        {buckets.map((bucket) => (
          <div
            key={bucket.id}
            className="flex-1 rounded-t-sm bg-[var(--color-accent)]/50"
            style={{ height: `${Math.max(4, (bucket.count / maxCount) * 100)}%` }}
          />
        ))}
      </div>
      <p className="text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">
        {result.details}
      </p>
    </div>
  );
}
