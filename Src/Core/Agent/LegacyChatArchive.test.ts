const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../../Foundation/IPC/AgentStorageCommands", () => ({ AgentStorageIPC: mocks }));

import { archiveLegacyChat } from "./LegacyChatArchive";

describe("legacy chat archive", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.read.mockReset();
    mocks.write.mockReset();
  });
  it("archives both old formats before deleting their browser records", async () => {
    const sessions = JSON.stringify([{ id: "chat", content: "private history" }]);
    localStorage.setItem("aurona.ai.chat.sessions.v2", sessions);
    localStorage.setItem("aurona.ai.chat.history.v1", "[]");
    mocks.read
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => mocks.write.mock.calls[0][1]);
    await archiveLegacyChat();
    expect(JSON.parse(mocks.write.mock.calls[0][1]).records).toHaveLength(2);
    expect(localStorage.length).toBe(0);
  });
  it("retains all source records when storage verification fails", async () => {
    localStorage.setItem("aurona.ai.chat.sessions.v2", "[]");
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce("changed");
    await expect(archiveLegacyChat()).rejects.toThrow("verification failed");
    expect(localStorage.getItem("aurona.ai.chat.sessions.v2")).toBe("[]");
  });
  it("does not delete edits that arrive while the archive write is pending", async () => {
    localStorage.setItem("aurona.ai.chat.sessions.v2", "[]");
    mocks.read
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => mocks.write.mock.calls[0][1]);
    mocks.write.mockImplementationOnce(async () =>
      localStorage.setItem("aurona.ai.chat.sessions.v2", "[1]"),
    );
    await archiveLegacyChat();
    expect(localStorage.getItem("aurona.ai.chat.sessions.v2")).toBe("[1]");
  });
});
