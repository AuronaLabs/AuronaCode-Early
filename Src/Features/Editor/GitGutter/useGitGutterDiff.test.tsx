import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  diff: vi.fn(),
  git: undefined as undefined | ((cache: unknown) => void),
}));
vi.mock("../../../Core/DocumentService", () => ({
  DocumentService: { subscribe: () => () => {}, get: () => ({ savedVersion: 1 }) },
}));
vi.mock("../../../Core/GitService", () => ({
  GitService: {
    getDiffCached: mocks.diff,
    subscribe: (listener: (cache: unknown) => void) => {
      mocks.git = listener;
      listener({ isRepo: true, repoPath: "C:/repo" });
      return () => {};
    },
  },
}));

import { setPathPlatform } from "../../../Shared/Utils/UriUtils";
import { useGitGutterDiff } from "./useGitGutterDiff";

describe("gutter request ownership", () => {
  afterEach(cleanup);
  it("does not let a late diff from the previous file replace the current gutter", async () => {
    setPathPlatform("windows");
    let finish!: (diff: string) => void;
    mocks.diff
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue("@@ -0,0 +1 @@\n+new");
    const hook = renderHook(({ path }) => useGitGutterDiff(path), {
      initialProps: { path: "c:/REPO/old.ts" },
    });
    await waitFor(() => expect(mocks.diff).toHaveBeenCalled());
    hook.rerender({ path: "C:/repo/new.ts" });
    await waitFor(() => expect(hook.result.current.addedLines.size).toBe(1));
    await act(async () => finish("@@ -1 +0,0 @@\n-old"));
    expect(hook.result.current.addedLines.size).toBe(1);
    expect(hook.result.current.deletedLines.size).toBe(0);
  });
});
