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
});
