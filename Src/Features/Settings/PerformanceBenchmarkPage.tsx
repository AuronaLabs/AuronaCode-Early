import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Card } from "../../UI/Components/Card";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";

type BenchmarkKind = "ipc" | "ui" | "filesystem" | "editor" | "search";

interface PerformanceEnvironment { appVersion: string; operatingSystem: string; architecture: string; logicalCpuCores: number; availableMemoryBytes: number; runMode: string; backendStatus: string; workspace: { pathOpen: boolean; topLevelEntries?: number }; }
interface StartupMetrics { backendToMainMs: number; frontendBootstrapMs: number; mainInteractiveMs: number; splashMinimumMs: number; recordedAtMs: number; }
interface BenchmarkResult { id: string; name: string; durationNs: number; value: number; unit: string; status: "ok" | "error"; details: string; }
interface BenchmarkSnapshot { schemaVersion: 1 | 2; generatedAt: string; environment: PerformanceEnvironment | null; startup: StartupMetrics | null; results: Partial<Record<BenchmarkKind, BenchmarkResult[]>>; sampleRuns?: number; warmupRuns?: number; }
interface PerformanceHistoryFile { schemaVersion: 2; latest: BenchmarkSnapshot | null; history: BenchmarkSnapshot[]; }
interface LeaderboardEntry { version: string; generatedAt: string; score: number; measuredMetrics: number; }

const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 9;
const IPC_WARMUP_RUNS = 24;
const IPC_SAMPLE_RUNS = 120;
const UI_WARMUP_FRAMES = 12;
const UI_SAMPLE_FRAMES = 90;
const BENCHMARKS: { id: BenchmarkKind; label: string; description: string }[] = [
  { id: "ipc", label: "IPC 往返", description: "24 次预热后采样 120 次真实 Tauri 请求，包含 WebView 调度。" },
  { id: "ui", label: "主线程帧调度", description: "连续采样 90 帧的 requestAnimationFrame 间隔，反映当前 UI 响应压力。" },
  { id: "filesystem", label: "文件系统", description: "临时目录内创建、读取、覆写、元数据读取、遍历与删除 320 个文件。" },
  { id: "editor", label: "编辑器内核", description: "使用 Rust Rope 执行文档创建、快照、局部读写和批量编辑。" },
  { id: "search", label: "搜索能力", description: "对 256 个临时源码样本调用真实工作区搜索引擎。" },
];
const formatDuration = (nanoseconds: number) => nanoseconds < 1_000 ? `${nanoseconds.toFixed(0)} ns` : nanoseconds < 1_000_000 ? `${(nanoseconds / 1_000).toFixed(2)} μs` : nanoseconds < 1_000_000_000 ? `${(nanoseconds / 1_000_000).toFixed(2)} ms` : `${(nanoseconds / 1_000_000_000).toFixed(2)} s`;
const formatMemory = (bytes: number) => bytes ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : "未提供";
const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
const percentile = (values: number[], point: number) => { const sorted = [...values].sort((left, right) => left - right); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * point) - 1)] || 0; };
const coefficientOfVariation = (values: number[]) => { const mean = average(values); return mean ? (Math.sqrt(average(values.map((value) => (value - mean) ** 2))) / mean) * 100 : 0; };
const trimmedSamples = (values: number[]) => { const sorted = [...values].sort((left, right) => left - right); return sorted.length >= 5 ? sorted.slice(1, -1) : sorted; };
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const environmentKey = (environment: PerformanceEnvironment | null) => environment ? `${environment.operatingSystem}|${environment.architecture}|${environment.logicalCpuCores}` : "unknown";
const normalizeHistory = (raw: PerformanceHistoryFile | BenchmarkSnapshot | null): PerformanceHistoryFile => {
  if (!raw) return { schemaVersion: 2, latest: null, history: [] };
  if ("history" in raw && Array.isArray(raw.history)) {
    const stored = raw as PerformanceHistoryFile;
    return { schemaVersion: 2, latest: stored.latest ?? stored.history.at(-1) ?? null, history: stored.history };
  }
  const legacy = raw as BenchmarkSnapshot;
  return { schemaVersion: 2, latest: legacy, history: [legacy] };
};
const getResult = (snapshot: BenchmarkSnapshot, id: string) => Object.values(snapshot.results).flat().find((result) => result?.id === id && result.status === "ok");

const aggregateSuites = (suites: BenchmarkResult[][]): BenchmarkResult[] => {
  const grouped = new Map<string, BenchmarkResult[]>();
  for (const suite of suites) for (const result of suite) grouped.set(result.id, [...(grouped.get(result.id) ?? []), result]);
  return [...grouped.values()].map((samples) => {
    const first = samples[0];
    if (samples.some((sample) => sample.status === "error")) return first;
    const durations = samples.map((sample) => sample.durationNs);
    const stableDurations = trimmedSamples(durations);
    return { ...first, durationNs: Math.round(average(stableDurations)), value: average(trimmedSamples(samples.map((sample) => sample.value))), details: `${first.details} · ${samples.length} 轮去极值平均 ${formatDuration(average(stableDurations))} · 中位数 ${formatDuration(percentile(durations, 0.5))} · P95 ${formatDuration(percentile(durations, 0.95))} · 波动 ${coefficientOfVariation(stableDurations).toFixed(1)}%` };
  });
};

export function PerformanceBenchmarkPage() {
  const [environment, setEnvironment] = useState<PerformanceEnvironment | null>(null);
  const [startup, setStartup] = useState<StartupMetrics | null>(null);
  const [results, setResults] = useState<Partial<Record<BenchmarkKind, BenchmarkResult[]>>>({});
  const [history, setHistory] = useState<BenchmarkSnapshot[]>([]);
  const [baseline, setBaseline] = useState<BenchmarkSnapshot | null>(null);
  const [runningKind, setRunningKind] = useState<BenchmarkKind | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const cancellationRef = useRef(0);

  const refreshContext = useCallback(async () => {
    const workspace = await WorkspaceStore.get().catch(() => ({ lastOpenedPath: undefined }));
    const [nextEnvironment, nextStartup, savedHistory] = await Promise.all([
      invoke<PerformanceEnvironment>("get_performance_environment", { workspacePath: workspace.lastOpenedPath ?? null }),
      invoke<StartupMetrics | null>("get_startup_metrics"),
      invoke<PerformanceHistoryFile | BenchmarkSnapshot | null>("load_performance_baseline"),
    ]);
    const normalized = normalizeHistory(savedHistory);
    setEnvironment(nextEnvironment); setStartup(nextStartup); setHistory(normalized.history); setBaseline(normalized.latest);
  }, []);

  useEffect(() => { void refreshContext().catch((error) => showToast(`无法读取性能环境：${String(error)}`, "error")); return () => { cancellationRef.current += 1; }; }, [refreshContext]);

  const runIpcBenchmark = useCallback(async (): Promise<BenchmarkResult[]> => {
    for (let index = 0; index < IPC_WARMUP_RUNS; index += 1) await invoke("aurona_bridge", { req: { action: "sys:ping" } });
    const samples: number[] = [];
    for (let index = 0; index < IPC_SAMPLE_RUNS; index += 1) { const started = performance.now(); await invoke("aurona_bridge", { req: { action: "sys:ping" } }); samples.push(performance.now() - started); }
    const mean = average(samples);
    return [{ id: "ipc-roundtrip", name: "前端至 Rust 往返", durationNs: Math.round(mean * 1_000_000), value: mean, unit: "ms", status: "ok", details: `${IPC_SAMPLE_RUNS} 次 · 平均 ${mean.toFixed(3)} ms · 最小 ${Math.min(...samples).toFixed(3)} ms · P95 ${percentile(samples, 0.95).toFixed(3)} ms · 波动 ${coefficientOfVariation(samples).toFixed(1)}%` }];
  }, []);

  const runUiBenchmark = useCallback(async (): Promise<BenchmarkResult[]> => {
    for (let index = 0; index < UI_WARMUP_FRAMES; index += 1) await frame();
    let previous = await frame(); const samples: number[] = [];
    for (let index = 0; index < UI_SAMPLE_FRAMES; index += 1) { const current = await frame(); samples.push(current - previous); previous = current; }
    const mean = average(samples);
    return [{ id: "ui-frame-cadence", name: "主线程帧间隔", durationNs: Math.round(mean * 1_000_000), value: mean, unit: "ms", status: "ok", details: `${UI_SAMPLE_FRAMES} 帧 · 平均 ${mean.toFixed(2)} ms · 最小 ${Math.min(...samples).toFixed(2)} ms · P95 ${percentile(samples, 0.95).toFixed(2)} ms · 波动 ${coefficientOfVariation(samples).toFixed(1)}%` }];
  }, []);

  const runBenchmark = useCallback(async (kind: BenchmarkKind, token: number) => {
    setRunningKind(kind);
    try {
      const execute = () => kind === "ipc" ? runIpcBenchmark() : kind === "ui" ? runUiBenchmark() : invoke<BenchmarkResult[]>("run_performance_benchmark", { kind });
      const sampleRuns = kind === "ipc" || kind === "ui" ? 1 : SAMPLE_RUNS;
      if (sampleRuns > 1) for (let index = 0; index < WARMUP_RUNS; index += 1) await execute();
      if (cancellationRef.current !== token) return false;
      const samples: BenchmarkResult[][] = [];
      for (let index = 0; index < sampleRuns; index += 1) { samples.push(await execute()); if (cancellationRef.current !== token) return false; }
      setResults((current) => ({ ...current, [kind]: aggregateSuites(samples) })); setLastRunAt(new Date().toISOString()); return true;
    } catch (error) {
      if (cancellationRef.current !== token) return false;
      setResults((current) => ({ ...current, [kind]: [{ id: `${kind}-error`, name: BENCHMARKS.find((benchmark) => benchmark.id === kind)?.label || kind, durationNs: 0, value: 0, unit: "", status: "error", details: String(error) }] }));
      showToast(`${BENCHMARKS.find((benchmark) => benchmark.id === kind)?.label || kind}测试失败`, "error"); return false;
    } finally { if (cancellationRef.current === token) setRunningKind(null); }
  }, [runIpcBenchmark, runUiBenchmark]);

  const runOne = useCallback(async (kind: BenchmarkKind) => { if (runningKind || isRunningAll) return; const token = cancellationRef.current + 1; cancellationRef.current = token; await runBenchmark(kind, token); }, [isRunningAll, runBenchmark, runningKind]);
  const runAll = useCallback(async () => { if (runningKind || isRunningAll) return; const token = cancellationRef.current + 1; cancellationRef.current = token; setIsRunningAll(true); for (const benchmark of BENCHMARKS) if (!(await runBenchmark(benchmark.id, token)) || cancellationRef.current !== token) break; if (cancellationRef.current === token) { setRunningKind(null); setIsRunningAll(false); } }, [isRunningAll, runBenchmark, runningKind]);
  const cancel = () => { cancellationRef.current += 1; setRunningKind(null); setIsRunningAll(false); showToast("已停止后续采样；当前原子测试会安全结束并清理临时文件。", "info"); };

  const snapshot = useMemo<BenchmarkSnapshot>(() => ({ schemaVersion: 2, generatedAt: lastRunAt || new Date().toISOString(), environment, startup, results, sampleRuns: SAMPLE_RUNS, warmupRuns: WARMUP_RUNS }), [environment, lastRunAt, results, startup]);
  const leaderboard = useMemo<LeaderboardEntry[]>(() => {
    const latestByVersion = new Map<string, BenchmarkSnapshot>();
    for (const item of history.filter((item) => environmentKey(item.environment) === environmentKey(environment))) { const version = item.environment?.appVersion ?? "未知版本"; if (!latestByVersion.has(version) || latestByVersion.get(version)!.generatedAt < item.generatedAt) latestByVersion.set(version, item); }
    const contenders = [...latestByVersion.values()];
    const metricIds = [...new Set(contenders.flatMap((item) => Object.values(item.results).flat().map((result) => result?.id).filter(Boolean) as string[]))];
    return contenders.map((item) => { const ratios = metricIds.flatMap((id) => { const duration = getResult(item, id)?.durationNs; const fastest = Math.min(...contenders.map((candidate) => getResult(candidate, id)?.durationNs ?? Number.POSITIVE_INFINITY)); return duration && Number.isFinite(fastest) ? [fastest / duration] : []; }); return { version: item.environment?.appVersion ?? "未知版本", generatedAt: item.generatedAt, score: average(ratios) * 100, measuredMetrics: ratios.length }; }).filter((item) => item.measuredMetrics > 0).sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
  }, [environment, history]);

  const saveBaseline = async () => {
    if (Object.keys(results).length === 0) { showToast("请先完成至少一项性能测试", "warning"); return; }
    try { const nextHistory = [...history, snapshot].slice(-30); const payload: PerformanceHistoryFile = { schemaVersion: 2, latest: snapshot, history: nextHistory }; await invoke("save_performance_baseline", { baseline: payload }); setHistory(nextHistory); setBaseline(snapshot); showToast("已保存本次性能记录，并加入本地版本排行榜。", "success"); } catch (error) { showToast(`保存性能记录失败：${String(error)}`, "error"); }
  };
  const copySnapshot = async () => { try { await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2)); showToast("性能结果 JSON 已复制", "success"); } catch (error) { showToast(`复制性能结果失败：${String(error)}`, "error"); } };
  const exportSnapshot = async () => { try { const target = await save({ defaultPath: `aurona-performance-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] }); if (!target) return; await writeTextFile(target, JSON.stringify(snapshot, null, 2)); showToast("性能结果已导出", "success"); } catch (error) { showToast(`导出性能结果失败：${String(error)}`, "error"); } };

  return <InternalPageLayout title="性能测试" icon={<Icons.History size={24} />} maxWidth="max-w-5xl" headerRight={<div className="flex items-center gap-2"><Button variant="secondary" size="sm" onClick={() => void refreshContext()} disabled={!!runningKind}><Icons.Refresh size={14} /> 刷新环境</Button>{runningKind || isRunningAll ? <Button variant="danger" size="sm" onClick={cancel}><Icons.Close size={14} /> 取消</Button> : <Button variant="primary" size="sm" onClick={() => void runAll()}><Icons.Play size={14} /> 运行全部</Button>}</div>}>
    <div className="flex flex-col gap-6 pb-10">
      <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--TextMuted)]">测试仅使用本地 Rust、IPC 与临时数据路径，不访问网络、不修改工作区。后端套件预热 {WARMUP_RUNS} 轮后采样 {SAMPLE_RUNS} 轮，并以去除最高、最低值后的平均结果作为本次记录；IPC 与帧调度使用独立的密集采样。运行期间 CPU、内存、磁盘缓存和后台任务都会影响结果，因此排行榜仅比较同一硬件轮廓下保存的本地记录。</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-5"><div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--TextHighlight)]"><Icons.Monitor size={17} /> 运行环境</div>{environment ? <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12px]">{[["版本", `v${environment.appVersion}`], ["运行模式", environment.runMode], ["系统", environment.operatingSystem], ["架构", environment.architecture], ["逻辑核心", `${environment.logicalCpuCores}`], ["可用内存", formatMemory(environment.availableMemoryBytes)], ["后端", environment.backendStatus], ["工作区", environment.workspace.pathOpen ? `${environment.workspace.topLevelEntries ?? "?"} 个顶层项目` : "未打开"]].map(([label, value]) => <div key={label} className="flex flex-col gap-0.5"><span className="text-[var(--TextMuted)]">{label}</span><span className="truncate font-medium text-[var(--TextPrimary)]" title={value}>{value}</span></div>)}</div> : <span className="text-[12px] text-[var(--TextMuted)]">正在读取运行环境…</span>}</Card>
        <Card className="flex flex-col gap-4 p-5"><div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--TextHighlight)]"><Icons.History size={17} /> 最近启动记录</div>{startup ? <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12px]"><div><span className="block text-[var(--TextMuted)]">前端资源初始化</span><b>{startup.frontendBootstrapMs.toFixed(1)} ms</b></div><div><span className="block text-[var(--TextMuted)]">主界面完成加载</span><b>{startup.mainInteractiveMs.toFixed(1)} ms</b></div><div><span className="block text-[var(--TextMuted)]">后端至主界面</span><b>{startup.backendToMainMs.toFixed(1)} ms</b></div><div><span className="block text-[var(--TextMuted)]">Splash 展示策略</span><b>{startup.splashMinimumMs.toFixed(0)} ms（不计入）</b></div></div> : <span className="text-[12px] text-[var(--TextMuted)]">本次启动尚未记录指标。</span>}</Card>
      </div>
      <Card className="flex flex-col gap-4 p-5">
        <div><h2 className="text-[14px] font-semibold text-[var(--TextHighlight)]">版本排行榜</h2><p className="mt-1 text-[12px] text-[var(--TextMuted)]">按版本号从新到旧排列。得分只反映当前设备上的相对趋势，不用于跨设备比较。</p></div>
        {leaderboard.length ? <div className="overflow-hidden rounded-lg border border-[var(--GlassBorder)]"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-[var(--GlassBorder)] bg-[var(--GlassSurface-Elevated)] px-3 py-2 text-[11px] text-[var(--TextMuted)]"><span>版本与测试时间</span><span>相对得分</span></div>{leaderboard.map((entry) => <div key={`${entry.version}-${entry.generatedAt}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--GlassBorder)] px-3 py-3 text-[12px] last:border-b-0"><div className="min-w-0"><b className="text-[var(--TextPrimary)]">v{entry.version}</b><span className="ml-2 text-[var(--TextMuted)]">{new Date(entry.generatedAt).toLocaleString()} · {entry.measuredMetrics} 项</span></div><b className="font-mono text-[var(--TextHighlight)]">{entry.score.toFixed(1)}</b></div>)}</div> : <span className="text-[12px] text-[var(--TextMuted)]">保存一次测试结果后会出现在这里；升级到新版本后再次保存，即可形成版本对比。</span>}
      </Card>
      <Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[14px] font-semibold text-[var(--TextHighlight)]">测试控制</h2><p className="mt-1 text-[12px] text-[var(--TextMuted)]">{runningKind ? `正在执行：${BENCHMARKS.find((item) => item.id === runningKind)?.label}` : lastRunAt ? `最近运行：${new Date(lastRunAt).toLocaleString()}` : "尚未运行测试"}</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => void saveBaseline()} disabled={!Object.keys(results).length || !!runningKind}>保存本次记录</Button><Button variant="ghost" size="sm" onClick={() => void copySnapshot()} disabled={!Object.keys(results).length}>复制 JSON</Button><Button variant="ghost" size="sm" onClick={() => void exportSnapshot()} disabled={!Object.keys(results).length}><Icons.Download size={14} /> 导出</Button></div></div></Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {BENCHMARKS.map((benchmark) => {
          const suite = results[benchmark.id];
          return <Card key={benchmark.id} className="flex min-w-0 flex-col gap-4 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><h2 className="text-[14px] font-semibold text-[var(--TextHighlight)]">{benchmark.label}</h2><p className="mt-1 text-[12px] leading-relaxed text-[var(--TextMuted)]">{benchmark.description}</p></div>
              <Button className="w-full shrink-0 whitespace-nowrap sm:w-auto" variant="secondary" size="sm" onClick={() => void runOne(benchmark.id)} disabled={!!runningKind || isRunningAll}><Icons.Play size={13} /> 单独运行</Button>
            </div>
            {suite ? <div className="flex flex-col gap-2">{suite.map((result) => {
              const previous = baseline ? getResult(baseline, result.id) : undefined;
              const delta = previous && previous.durationNs > 0 ? ((result.durationNs - previous.durationNs) / previous.durationNs) * 100 : null;
              return <div key={result.id} className={`rounded-lg border px-3 py-2.5 ${result.status === "error" ? "border-red-500/30 bg-red-500/10" : "border-[var(--GlassBorder)] bg-[var(--GlassSurface-Elevated)]"}`}>
                <div className="flex items-center justify-between gap-3 text-[12px]"><span className="min-w-0 font-medium text-[var(--TextPrimary)]">{result.name}</span><span className={result.status === "error" ? "shrink-0 text-red-500" : "shrink-0 font-mono text-[var(--TextHighlight)]"}>{result.status === "error" ? "失败" : formatDuration(result.durationNs)}</span></div>
                <div className="mt-1.5 flex flex-col gap-1 text-[11px] leading-relaxed text-[var(--TextMuted)]"><span className="break-words">{result.details}</span>{delta !== null && <span className={delta > 5 ? "text-amber-500" : delta < -5 ? "text-emerald-500" : ""}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}% 对比已保存记录</span>}</div>
              </div>;
            })}</div> : <div className="flex min-h-24 flex-1 items-center text-[12px] text-[var(--TextMuted)]">等待运行。结果会保留在当前页面，直到重新测试或关闭标签页。</div>}
          </Card>;
        })}
      </div>
    </div>
  </InternalPageLayout>;
}
