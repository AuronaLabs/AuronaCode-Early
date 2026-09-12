import { describe, expect, it } from "vitest";
import {
  type BenchmarkResult,
  type BenchmarkSnapshot,
  calculateCompositeScore,
  compareSemanticVersionsDescending,
  environmentKey,
  normalizeHistory,
  PERFORMANCE_PROFILE,
  type PerformanceEnvironment,
  snapshotComparabilityKey,
} from "./PerformanceBenchmarkModel";

const environment: PerformanceEnvironment = {
  appVersion: "0.3.0",
  operatingSystem: "Windows 11",
  architecture: "x86_64",
  logicalCpuCores: 16,
  physicalCpuCores: 8,
  cpuModel: "Example CPU",
  availableMemoryBytes: 16_000_000_000,
  runMode: "release",
  backendStatus: "ready",
  workspace: { pathOpen: true },
};

const snapshot = (schemaVersion: 1 | 2 | 3): BenchmarkSnapshot => ({
  schemaVersion,
  profile: schemaVersion === 3 ? PERFORMANCE_PROFILE : undefined,
  generatedAt: "2026-07-17T00:00:00.000Z",
  environment,
  startup: null,
  results: {},
});

describe("performance benchmark model", () => {
  it("migrates v2 history without discarding snapshots", () => {
    const legacy = snapshot(2);
    const migrated = normalizeHistory({ schemaVersion: 2, latest: null, history: [legacy] });

    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.latest).toBe(legacy);
    expect(migrated.history).toEqual([legacy]);
  });

  it("keeps legacy snapshots out of v3 comparisons", () => {
    const current = snapshot(3);
    current.comparabilityKey = environmentKey(environment);

    expect(snapshotComparabilityKey(snapshot(2))).toBeNull();
    expect(snapshotComparabilityKey(current)).toBe(environmentKey(environment));
    expect(environmentKey({ ...environment, runMode: "development" })).not.toBe(
      environmentKey(environment),
    );
  });

  it("sorts release versions using semantic version precedence", () => {
    const versions = ["0.2.9", "0.3.0-beta.2", "0.2.10", "0.3.0"];
    versions.sort(compareSemanticVersionsDescending);

    expect(versions).toEqual(["0.3.0", "0.3.0-beta.2", "0.2.10", "0.2.9"]);
  });

  const result = (overrides: Partial<BenchmarkResult>): BenchmarkResult => ({
    id: "filesystem-create",
    name: "小文件创建",
    durationNs: 0,
    value: 1,
    unit: "ops/s",
    status: "ok",
    details: "",
    ...overrides,
  });

  it("scores batched operations by per-operation latency instead of total batch time", () => {
    // 320 个文件耗时 100ms（吞吐 3200 ops/s）：旧模型按整段时长打地板分，新模型按单次耗时给分
    const batch: BenchmarkSnapshot = {
      ...snapshot(3),
      results: {
        filesystem: [
          result({
            durationNs: 100_000_000,
            value: 3200,
          }),
        ],
      },
    };

    expect(calculateCompositeScore(batch)).toBeGreaterThan(90);
  });

  it("keeps slow single operations and ui jitter clamped to the 60-100 band", () => {
    const slowWasm: BenchmarkSnapshot = {
      ...snapshot(3),
      results: {
        wasm: [
          result({
            id: "wasm-component-compile",
            name: "WASM 组件 JIT 编译",
            durationNs: 250_000_000,
            value: 4,
          }),
        ],
      },
    };
    const jitteryUi: BenchmarkSnapshot = {
      ...snapshot(3),
      results: {
        ui: [
          result({
            id: "ui-frame-cadence",
            name: "主线程帧间隔",
            unit: "ms",
            durationNs: 16_000_000,
            statistics: { meanNs: 0, trimmedMeanNs: 0, p95Ns: 0, coefficientVariation: 30 },
          }),
        ],
      },
    };

    expect(calculateCompositeScore(slowWasm)).toBe(60);
    expect(calculateCompositeScore(jitteryUi)).toBe(60);
  });
});
