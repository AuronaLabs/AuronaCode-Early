import { OutputService } from "./OutputService";

describe("OutputService", () => {
  beforeEach(() => OutputService.clear("core"));

  it("redacts secrets and notifies subscribers", () => {
    const listener = vi.fn();
    const dispose = OutputService.subscribe(listener);
    OutputService.append("core", "api_key=super-secret");

    expect(OutputService.getChannel("core").entries.at(-1)?.message).toBe("api_key=[REDACTED]");
    expect(listener).toHaveBeenCalled();
    dispose();
  });

  it("bounds channel history", () => {
    for (let index = 0; index < 5_100; index++) {
      OutputService.append("core", `entry-${index}`);
    }
    expect(OutputService.getChannel("core").entries).toHaveLength(5_000);
  });

  it("registers and reuses dynamic extension channels under the extension namespace", () => {
    const first = OutputService.ensureExtensionChannel("demo.ext.Build Log", "Build Log");
    const second = OutputService.ensureExtensionChannel("demo.ext.Build Log", "Build Log");
    expect(first).toBe("extension:demo.ext.Build Log");
    expect(second).toBe(first);
    expect(OutputService.getChannels().some((channel) => channel.id === first)).toBe(true);

    OutputService.append(first, "build started");
    expect(OutputService.getChannel(first).entries.at(-1)?.message).toBe("build started");
    expect(OutputService.getChannel(first).label).toBe("Build Log");
  });
});
