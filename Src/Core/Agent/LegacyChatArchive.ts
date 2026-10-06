import { AgentStorageIPC } from "../../Foundation/IPC/AgentStorageCommands";

const KEYS = ["aurona.ai.chat.sessions.v2", "aurona.ai.chat.history.v1"] as const;
interface Archive {
  schema: 1;
  records: Array<{ key: string; content: string }>;
}
let migration: Promise<void> | null = null;

export function archiveLegacyChat(): Promise<void> {
  if (migration) return migration;
  migration = migrate().finally(() => {
    migration = null;
  });
  return migration;
}

async function migrate(): Promise<void> {
  const pending = KEYS.flatMap((key) => {
    const content = localStorage.getItem(key);
    return content === null ? [] : [{ key, content }];
  });
  if (pending.length === 0) return;
  const previous = await AgentStorageIPC.read("legacy-chat");
  const archive: Archive = previous ? JSON.parse(previous) : { schema: 1, records: [] };
  if (
    archive.schema !== 1 ||
    !Array.isArray(archive.records) ||
    archive.records.length > 16 ||
    archive.records.some(
      (record) =>
        !KEYS.includes(record.key as (typeof KEYS)[number]) || typeof record.content !== "string",
    )
  )
    throw new Error(
      "[agent.archive_schema] Legacy archive is malformed; original history is preserved",
    );
  for (const record of pending) {
    const parsed: unknown = JSON.parse(record.content);
    if (parsed === null || typeof parsed !== "object")
      throw new Error(
        "[agent.archive_schema] Legacy history is malformed; original data is preserved",
      );
    if (
      !archive.records.some(
        (stored) => stored.key === record.key && stored.content === record.content,
      )
    )
      archive.records.push(record);
  }
  if (archive.records.length > 16)
    throw new Error("[agent.archive_quota] Legacy archive record quota reached");
  const content = JSON.stringify(archive);
  if (new TextEncoder().encode(content).byteLength > 64 * 1024 * 1024)
    throw new Error("[agent.archive_quota] Legacy archive exceeds history quota");
  await AgentStorageIPC.write("legacy-chat", content);
  if ((await AgentStorageIPC.read("legacy-chat")) !== content)
    throw new Error(
      "[agent.archive_verify] Legacy archive verification failed; original history is preserved",
    );
  for (const record of pending)
    if (localStorage.getItem(record.key) === record.content) localStorage.removeItem(record.key);
}
