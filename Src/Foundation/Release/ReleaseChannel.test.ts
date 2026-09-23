import { describe, expect, it } from "vitest";
import {
  compareAuronaVersions,
  formatDisplayVersion,
  getBuildChannel,
  isPioneerBuild,
  parseAuronaVersion,
} from "./ReleaseChannel";

describe("ReleaseChannel & Version Model", () => {
  it("renders internal versions as display text", () => {
    expect(formatDisplayVersion("0.4.0")).toBe("0.4.0");
    expect(formatDisplayVersion("v0.4.0-pioneer.4")).toBe("0.4.0 Pioneer 4");
    expect(formatDisplayVersion("0.4.0-pioneer.12")).toBe("0.4.0 Pioneer 12");
    expect(formatDisplayVersion("0.5.0-beta.2")).toBe("0.5.0 Beta 2");
    // Changelog 数据使用大写 V 前缀，同样需要正确解析
    expect(formatDisplayVersion("V0.4.0-pioneer.5")).toBe("0.4.0 Pioneer 5");
    expect(formatDisplayVersion("V0.3.16")).toBe("0.3.16");
  });
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
