const invoke = vi.hoisted(() => vi.fn());
vi.mock("../Desktop", () => ({ invokeDesktop: invoke }));

import { EditorIPC } from "./EditorCommands";

it("uses Tauri camelCase viewport arguments and rejects stale highlight results", async () => {
  const path = "C:/audit/large-file.ts";
  invoke.mockResolvedValueOnce({ revision: 7, diskFingerprint: "disk" });
  await EditorIPC.open(path);
  const lines = [{ text: "const value = 1", tokens: [] }];
  invoke.mockResolvedValueOnce({ revision: 7, startLine: 100, lines });
  expect((await EditorIPC.getLines(path, 100, 120)).lines).toEqual(lines);
  expect(invoke).toHaveBeenLastCalledWith("get_editor_lines", {
    path,
    startLine: 100,
    endLine: 120,
  });
  invoke.mockResolvedValueOnce({ revision: 6, startLine: 100, lines });
  expect((await EditorIPC.getLines(path, 100, 120)).lines).toEqual([]);
  invoke.mockResolvedValueOnce(undefined);
  await EditorIPC.close(path, true);
});
