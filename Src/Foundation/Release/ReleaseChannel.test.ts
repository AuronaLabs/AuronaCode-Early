import { describe, expect, it } from "vitest";
import {
  type AvailableRemoteVersion,
  compareAuronaVersions,
  getBuildChannel,
  isPioneerBuild,
  parseAuronaVersion,
  resolveTargetUpdateVersion,
} from "./ReleaseChannel";

describe("ReleaseChannel & Version Model", () => {
  it("parses stable and pioneer pre-release versions", () => {
    expect(parseAuronaVersion("0.4.0")).toEqual({
      major: 0,
      minor: 4,
      patch: 0,
      isPreRelease: false,
    });

    expect(parseAuronaVersion("v0.4.1-pioneer.1")).toEqual({
      major: 0,
      minor: 4,
      patch: 1,
      isPreRelease: true,
      preReleaseTag: "pioneer",
      preReleaseIter: 1,
    });
  });

  it("strictly implements SemVer 2.0 comparison rules: 0.4.0 < 0.4.1-pioneer.1 < 0.4.1", () => {
    // 0.4.0 < 0.4.1-pioneer.1
    expect(compareAuronaVersions("0.4.0", "0.4.1-pioneer.1")).toBeLessThan(0);

    // 0.4.1-pioneer.1 < 0.4.1-pioneer.2
    expect(compareAuronaVersions("0.4.1-pioneer.1", "0.4.1-pioneer.2")).toBeLessThan(0);

    // 0.4.1-pioneer.2 < 0.4.1 (正式版大于预发布版)
    expect(compareAuronaVersions("0.4.1-pioneer.2", "0.4.1")).toBeLessThan(0);

    // 0.4.1 === 0.4.1
    expect(compareAuronaVersions("0.4.1", "0.4.1")).toBe(0);

    // 0.4.1 > 0.4.0
    expect(compareAuronaVersions("0.4.1", "0.4.0")).toBeGreaterThan(0);
  });

  it("resolves target update for Stable clients without taking Pioneer pre-releases", () => {
    const remotes: AvailableRemoteVersion[] = [
      { version: "0.4.0", channel: "stable" },
      { version: "0.4.1-pioneer.1", channel: "pioneer" },
      { version: "0.4.1", channel: "stable" },
    ];

    // Stable 客户端处于 0.4.0 时，即使有 0.4.1-pioneer.1，也只认 0.4.1 正式版
    const target = resolveTargetUpdateVersion("stable", "0.4.0", remotes);
    expect(target).not.toBeNull();
    expect(target?.version).toBe("0.4.1");
    expect(target?.channel).toBe("stable");
  });

  it("resolves target update for Pioneer clients in iOS Developer Beta style", () => {
    // 场景 A: Pioneer 客户端处于 0.4.0，远程发布了 0.4.1-pioneer.1
    const remotesA: AvailableRemoteVersion[] = [
      { version: "0.4.0", channel: "stable" },
      { version: "0.4.1-pioneer.1", channel: "pioneer" },
    ];
    const targetA = resolveTargetUpdateVersion("pioneer", "0.4.0", remotesA);
    expect(targetA?.version).toBe("0.4.1-pioneer.1");

    // 场景 B: Pioneer 客户端处于 0.4.1-pioneer.1，远程发布了正式版 0.4.1，没有更新的 pioneer
    const remotesB: AvailableRemoteVersion[] = [
      { version: "0.4.0", channel: "stable" },
      { version: "0.4.1-pioneer.1", channel: "pioneer" },
      { version: "0.4.1", channel: "stable" },
    ];
    const targetB = resolveTargetUpdateVersion("pioneer", "0.4.1-pioneer.1", remotesB);
    expect(targetB?.version).toBe("0.4.1"); // 更新到正式版

    // 场景 C: Pioneer 客户端已在 0.4.1，远程发布了 0.4.2-pioneer.1，继续接收 pioneer 测试版
    const remotesC: AvailableRemoteVersion[] = [
      { version: "0.4.1", channel: "stable" },
      { version: "0.4.2-pioneer.1", channel: "pioneer" },
    ];
    const targetC = resolveTargetUpdateVersion("pioneer", "0.4.1", remotesC);
    expect(targetC?.version).toBe("0.4.2-pioneer.1");
  });

  it("reports default build channel as stable when no environment override exists", () => {
    const channel = getBuildChannel();
    expect(channel).toBe("stable");
  });

  it("correctly identifies pioneer build versions", () => {
    expect(isPioneerBuild("0.4.0-pioneer.1")).toBe(true);
    expect(isPioneerBuild("v0.4.0-pioneer.2")).toBe(true);
    expect(isPioneerBuild("0.4.0")).toBe(false);
    expect(isPioneerBuild("0.3.16")).toBe(false);
    expect(isPioneerBuild("0.4.0-beta.1")).toBe(false);
  });
});
