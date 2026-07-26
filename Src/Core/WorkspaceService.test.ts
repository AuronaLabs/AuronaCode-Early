import { WorkspaceService } from "./WorkspaceService";

vi.mock("../Foundation/Storage/WorkspaceStore", () => ({
  WorkspaceStore: {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => undefined),
  },
}));

describe("WorkspaceService", () => {
  it("represents a workspace with a roots array", async () => {
    await WorkspaceService.openRoot("C:\\work\\");
    expect(WorkspaceService.getCurrent()).toMatchObject({
      mode: "workspace",
      roots: ["C:\\work"],
      primaryRoot: "C:\\work",
    });
  });
});
