import { CONFIGURATION_DEFAULTS, resolveConfiguration, SECURITY_DEFAULTS } from "./index";

describe("effective configuration", () => {
  it("uses one set of defaults without rewriting source data", () => {
    const input = Object.freeze({});
    const config = resolveConfiguration(input);
    expect(config).toMatchObject(CONFIGURATION_DEFAULTS);
    expect(config.security).toEqual(SECURITY_DEFAULTS);
    expect(config.appearance.glassIntensity).toBe(50);
    expect(input).toEqual({});
  });
  it("preserves explicit false security switches and custom nested preferences", () => {
    const security = Object.fromEntries(Object.keys(SECURITY_DEFAULTS).map((key) => [key, false]));
    const config = resolveConfiguration({
      security,
      network: { proxyMode: "custom", proxyUrl: "http://127.0.0.1:7890" },
      appearance: { glassIntensity: 0 },
      editorSmoothScrolling: false,
    });
    expect(config.security).toEqual(security);
    expect(config.appearance.glassIntensity).toBe(0);
    expect(config.network.proxyUrl).toBe("http://127.0.0.1:7890");
    expect(config.editorSmoothScrolling).toBe(false);
  });
});
