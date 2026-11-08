import { describe, expect, it } from "vitest";
import { compareAuronaVersions, formatDisplayVersion, parseAuronaVersion } from "./ReleaseChannel";

describe("Version Model", () => {
  it("renders internal versions as display text", () => {
    expect(formatDisplayVersion("0.4.0")).toBe("0.4.0");
    expect(formatDisplayVersion("v0.4.0-beta.4")).toBe("0.4.0 Beta 4");
    expect(formatDisplayVersion("0.4.0-beta.12")).toBe("0.4.0 Beta 12");
    expect(formatDisplayVersion("0.5.0-beta.2")).toBe("0.5.0 Beta 2");
    // Changelog 数据使用大写 V 前缀，同样需要正确解析
    expect(formatDisplayVersion("V0.4.0-beta.5")).toBe("0.4.0 Beta 5");
    expect(formatDisplayVersion("V0.3.16")).toBe("0.3.16");
  });
  it("orders Alpha, Beta, numeric identifiers and stable releases using SemVer", () => {
    const versions = [
      "0.5.0-alpha",
      "0.5.0-alpha.1",
      "0.5.0-alpha.2",
      "0.5.0-alpha.10",
      "0.5.0-beta.1",
      "0.5.0-rc.1",
      "0.5.0",
    ];
    for (let i = 1; i < versions.length; i++) {
      expect(compareAuronaVersions(versions[i - 1], versions[i])).toBeLessThan(0);
      expect(compareAuronaVersions(versions[i], versions[i - 1])).toBeGreaterThan(0);
    }
    expect(compareAuronaVersions("0.5.0-alpha.1+local", "0.5.0-alpha.1+ci")).toBe(0);
    expect(formatDisplayVersion("0.5.0-alpha.1")).toBe("0.5.0 Alpha1");
  });
  it("parses stable and beta pre-release versions", () => {
    expect(parseAuronaVersion("0.4.0")).toEqual({
      major: 0,
      minor: 4,
      patch: 0,
      isPreRelease: false,
    });

    expect(parseAuronaVersion("v0.4.1-beta.1")).toEqual({
      major: 0,
      minor: 4,
      patch: 1,
      isPreRelease: true,
      preReleaseTag: "beta",
      preReleaseIter: 1,
    });
  });

  it("strictly implements SemVer 2.0 comparison rules: 0.4.0 < 0.4.1-beta.1 < 0.4.1", () => {
    // 0.4.0 < 0.4.1-beta.1
    expect(compareAuronaVersions("0.4.0", "0.4.1-beta.1")).toBeLessThan(0);

    // 0.4.1-beta.1 < 0.4.1-beta.2
    expect(compareAuronaVersions("0.4.1-beta.1", "0.4.1-beta.2")).toBeLessThan(0);

    // 0.4.1-beta.2 < 0.4.1 (正式版大于预发布版)
    expect(compareAuronaVersions("0.4.1-beta.2", "0.4.1")).toBeLessThan(0);

    // 0.4.1 === 0.4.1
    expect(compareAuronaVersions("0.4.1", "0.4.1")).toBe(0);

    // 0.4.1 > 0.4.0
    expect(compareAuronaVersions("0.4.1", "0.4.0")).toBeGreaterThan(0);
  });
});
