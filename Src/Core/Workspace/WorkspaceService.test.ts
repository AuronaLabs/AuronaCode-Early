import { FileSystemCommands } from "../../Foundation/IPC/FileSystemCommands";
import { PlatformService } from "../../Foundation/Platform";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { WorkspaceService } from "./index";

vi.mock("../../Foundation/IPC/FileSystemCommands", () => ({
  FileSystemCommands: {
    setWorkspaceRoot: vi.fn(async () => undefined),
  },
}));

vi.mock("../../Foundation/Storage/WorkspaceStore", () => ({
  WorkspaceStore: {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => undefined),
  },
}));

describe("WorkspaceService", () => {
  it("ignores an older open result after another workspace was requested", async () => {
    let complete!: () => void;
    vi.mocked(FileSystemCommands.setWorkspaceRoot).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const old = WorkspaceService.openRoot("/old");
    await WorkspaceService.openRoot("/new");
    complete();
    await old;
    expect(WorkspaceService.getCurrent().primaryRoot).toBe("/new");
  });

  it("does not restore a stored directory over an explicit open", async () => {
    let complete!: (saved: { lastOpenedPath: string }) => void;
    vi.mocked(WorkspaceStore.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const restore = WorkspaceService.initialize();
    await WorkspaceService.openRoot("/explicit");
    complete({ lastOpenedPath: "/stored" });
    await restore;
    expect(WorkspaceService.getCurrent().primaryRoot).toBe("/explicit");
  });

  it("keeps the active session when clearing the host root fails", async () => {
    await WorkspaceService.openRoot("/active");
    vi.mocked(FileSystemCommands.setWorkspaceRoot).mockRejectedValueOnce(new Error("host failed"));
    await expect(WorkspaceService.close()).rejects.toThrow("host failed");
    expect(WorkspaceService.getCurrent().primaryRoot).toBe("/active");
  });
  it("retains the recent directory after an authorization refusal", async () => {
    vi.mocked(WorkspaceStore.get).mockResolvedValueOnce({ lastOpenedPath: "/work" });
    vi.mocked(FileSystemCommands.setWorkspaceRoot).mockRejectedValueOnce(
      new Error("[workspace.denied] denied"),
    );
    vi.mocked(WorkspaceStore.set).mockClear();
    await WorkspaceService.initialize();
    expect(WorkspaceStore.set).not.toHaveBeenCalled();
    expect(WorkspaceService.getCurrent().mode).toBe("singleFile");
  });

  it("uses platform-specific case semantics for workspace identities", async () => {
    const platform = vi.spyOn(PlatformService, "current");
    platform.mockReturnValue("linux");
    await WorkspaceService.openRoot("/work/Project");
    const upper = WorkspaceService.getCurrent().id;
    await WorkspaceService.openRoot("/work/project");
    expect(WorkspaceService.getCurrent().id).not.toBe(upper);
    platform.mockReturnValue("windows");
    await WorkspaceService.openRoot("C:\\Work\\Project");
    const windows = WorkspaceService.getCurrent().id;
    await WorkspaceService.openRoot("c:/work/project");
    expect(WorkspaceService.getCurrent().id).toBe(windows);
    platform.mockRestore();
  });

  it("preserves filesystem roots and does not turn a drive root into a drive-relative path", async () => {
    await WorkspaceService.openRoot("C:\\");
    expect(FileSystemCommands.setWorkspaceRoot).toHaveBeenLastCalledWith("C:\\");
    await WorkspaceService.openRoot("/");
    expect(WorkspaceService.getCurrent().primaryRoot).toBe("/");
  });
  it("represents a workspace with a roots array", async () => {
    await WorkspaceService.openRoot("C:\\work\\");
    expect(WorkspaceService.getCurrent()).toMatchObject({
      mode: "workspace",
      roots: ["C:\\work"],
      primaryRoot: "C:\\work",
    });
  });
});
