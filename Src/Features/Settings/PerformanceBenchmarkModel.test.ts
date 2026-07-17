import { describe, expect, it } from "vitest";
import {
  type BenchmarkSnapshot,
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
});
