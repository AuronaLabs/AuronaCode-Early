import { startExtensionHostBridge } from "./ExtensionHostBridge";

const mocks = vi.hoisted(() => ({ request: vi.fn(), notification: vi.fn(), status: vi.fn() }));
vi.mock("../../Foundation/IPC/ExtensionCommands", () => ({
  ExtensionIPC: {
    onHostRequest: mocks.request,
    onNotification: mocks.notification,
    onStatusMessage: mocks.status,
  },
}));
vi.mock("../../UI/Feedback/Toast", () => ({ showToast: vi.fn() }));

describe("extension host bridge ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const listen of Object.values(mocks)) listen.mockImplementation(async () => vi.fn());
  });
  it("releases listeners exactly once across 20 complete lifecycles", async () => {
    for (let cycle = 0; cycle < 20; cycle++) {
      const dispose = await startExtensionHostBridge();
      const other = await startExtensionHostBridge();
      dispose();
      dispose();
      other();
      other();
    }
    for (const listen of Object.values(mocks)) {
      expect(listen).toHaveBeenCalledTimes(20);
      for (const result of listen.mock.results) expect(await result.value).toHaveBeenCalledOnce();
    }
  });
  it("cleans partial registration and permits retry", async () => {
    const dispose = vi.fn();
    mocks.request.mockResolvedValueOnce(dispose);
    mocks.status.mockRejectedValueOnce(new Error("event registration failed"));
    await expect(startExtensionHostBridge()).rejects.toThrow("registration failed");
    expect(dispose).toHaveBeenCalledOnce();
    const stop = await startExtensionHostBridge();
    stop();
  });
});
