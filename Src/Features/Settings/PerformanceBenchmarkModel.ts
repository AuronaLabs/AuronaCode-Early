export type BenchmarkKind = "ipc" | "ui" | "filesystem" | "editor" | "search";

export interface PerformanceEnvironment {
  appVersion: string;
  operatingSystem: string;
  architecture: string;
  logicalCpuCores: number;
  physicalCpuCores: number | null;
  cpuModel: string;
  availableMemoryBytes: number;
  runMode: string;
  backendStatus: string;
  workspace: { pathOpen: boolean; topLevelEntries?: number };
}

export interface StartupMetrics {
  backendToMainMs: number;
  frontendBootstrapMs: number;
  mainInteractiveMs: number;
  splashMinimumMs: number;
  recordedAtMs: number;
}

export interface BenchmarkResult {
  id: string;
  name: string;
  durationNs: number;
  value: number;
  unit: string;
  status: "ok" | "error";
  details: string;
  samplesNs?: number[];
  statistics?: {
    meanNs: number;
    trimmedMeanNs: number;
    p95Ns: number;
    coefficientVariation: number;
  };
}

export interface BenchmarkSnapshot {
  schemaVersion: 1 | 2 | 3;
  profile?: "aurona-desktop-v1";
  comparabilityKey?: string;
  generatedAt: string;
  environment: PerformanceEnvironment | null;
  startup: StartupMetrics | null;
  results: Partial<Record<BenchmarkKind, BenchmarkResult[]>>;
  sampleRuns?: number;
  warmupRuns?: number;
}

export interface PerformanceHistoryFile {
  schemaVersion: 2 | 3;
  latest: BenchmarkSnapshot | null;
  history: BenchmarkSnapshot[];
}

export interface LeaderboardEntry {
  version: string;
  generatedAt: string;
  score: number | null;
  measuredMetrics: number;
}

export const PERFORMANCE_PROFILE = "aurona-desktop-v1" as const;

export const environmentKey = (environment: PerformanceEnvironment | null) =>
  environment
    ? `${PERFORMANCE_PROFILE}|${environment.runMode}|${environment.operatingSystem}|${environment.architecture}|${environment.cpuModel || "unknown-cpu"}|${environment.physicalCpuCores ?? "unknown"}|${environment.logicalCpuCores}`
    : "unknown";

export const snapshotComparabilityKey = (snapshot: BenchmarkSnapshot) => {
  if (snapshot.schemaVersion !== 3 || snapshot.profile !== PERFORMANCE_PROFILE) return null;
  return snapshot.comparabilityKey ?? environmentKey(snapshot.environment);
};

export const normalizeHistory = (
  raw: PerformanceHistoryFile | BenchmarkSnapshot | null,
): PerformanceHistoryFile => {
  if (!raw) return { schemaVersion: 3, latest: null, history: [] };
  if ("history" in raw && Array.isArray(raw.history)) {
    return {
      schemaVersion: 3,
      latest: raw.latest ?? raw.history.at(-1) ?? null,
      history: raw.history,
    };
  }
  const legacySnapshot = raw as BenchmarkSnapshot;
  return { schemaVersion: 3, latest: legacySnapshot, history: [legacySnapshot] };
};

const semanticVersionParts = (version: string) => {
  const [core, prerelease = ""] = version.replace(/^v/i, "").split("-", 2);
  return {
    core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease,
  };
};

export const compareSemanticVersionsDescending = (left: string, right: string) => {
  const leftParts = semanticVersionParts(left);
  const rightParts = semanticVersionParts(right);
  const length = Math.max(leftParts.core.length, rightParts.core.length);
  for (let index = 0; index < length; index++) {
    const difference = (rightParts.core[index] ?? 0) - (leftParts.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (!leftParts.prerelease && rightParts.prerelease) return -1;
  if (leftParts.prerelease && !rightParts.prerelease) return 1;
  return rightParts.prerelease.localeCompare(leftParts.prerelease, undefined, { numeric: true });
};
