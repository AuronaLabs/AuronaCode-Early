import { describe, expect, it } from "vitest";
import { buildUpdateCheckOptions } from "./UpdaterService";

describe("buildUpdateCheckOptions", () => {
  it("passes the proxy only in custom mode with a proxy url", () => {
    expect(
      buildUpdateCheckOptions({ proxyMode: "custom", proxyUrl: "http://127.0.0.1:7897" }),
    ).toEqual({ proxy: "http://127.0.0.1:7897" });
  });

  it("ignores a custom mode without a proxy url", () => {
    expect(buildUpdateCheckOptions({ proxyMode: "custom" })).toBeUndefined();
    expect(buildUpdateCheckOptions({ proxyMode: "custom", proxyUrl: "" })).toBeUndefined();
  });

  it("follows system defaults for non-custom modes", () => {
    expect(buildUpdateCheckOptions({ proxyMode: "system", proxyUrl: "http://x" })).toBeUndefined();
    expect(buildUpdateCheckOptions({ proxyMode: "direct" })).toBeUndefined();
    expect(buildUpdateCheckOptions({})).toBeUndefined();
  });

  it("tolerates missing network preferences", () => {
    expect(buildUpdateCheckOptions(undefined)).toBeUndefined();
  });
});
