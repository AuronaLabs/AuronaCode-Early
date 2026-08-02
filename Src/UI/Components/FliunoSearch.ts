import type { CommandDefinition } from "../../Extension/CommandRegistry";
import type { WorkspaceFileEntry } from "../../Foundation/IPC/WorkspaceSearchCommands";

export type FliunoScope = "all" | "commands" | "files";

export type FliunoResult =
  | {
      id: string;
      kind: "command";
      command: CommandDefinition<unknown>;
      title: string;
      description: string;
      score: number;
      recent: boolean;
    }
  | {
      id: string;
      kind: "file";
      file: WorkspaceFileEntry;
      title: string;
      description: string;
      score: number;
      recent: boolean;
    };

export interface ParsedFliunoQuery {
  scope: FliunoScope;
  query: string;
  explicitScope: boolean;
}

export function parseFliunoQuery(value: string, selectedScope: FliunoScope): ParsedFliunoQuery {
  const trimmed = value.trimStart();
  if (trimmed.startsWith(">")) {
    return { scope: "commands", query: trimmed.slice(1).trimStart(), explicitScope: true };
  }
  if (trimmed.startsWith("@")) {
    return { scope: "files", query: trimmed.slice(1).trimStart(), explicitScope: true };
  }
  return { scope: selectedScope, query: value.trim(), explicitScope: false };
}

export function fuzzyScore(value: string, query: string): number {
  if (!query) return 0;
  const haystack = value.toLocaleLowerCase("zh-CN");
  const needle = query.toLocaleLowerCase("zh-CN");
  const direct = haystack.indexOf(needle);
  if (direct >= 0) {
    const boundaryBonus = direct === 0 || /[\s/\\._-]/.test(haystack[direct - 1] ?? "") ? 90 : 0;
    return 500 + boundaryBonus - direct - Math.max(0, haystack.length - needle.length) * 0.05;
  }

  let cursor = -1;
  let gaps = 0;
  let boundaryMatches = 0;
  for (const character of needle) {
    const next = haystack.indexOf(character, cursor + 1);
    if (next < 0) return -1;
    if (cursor >= 0) gaps += next - cursor - 1;
    if (next === 0 || /[\s/\\._-]/.test(haystack[next - 1] ?? "")) boundaryMatches += 1;
    cursor = next;
  }
  return 260 + boundaryMatches * 18 - gaps - cursor * 0.1;
}

export function buildFliunoResults(input: {
  commands: CommandDefinition<unknown>[];
  files: WorkspaceFileEntry[];
  scope: FliunoScope;
  query: string;
  recentCommands: string[];
  recentFiles: string[];
  openFiles: string[];
  excludedCommandId: string;
  limit?: number;
}): FliunoResult[] {
  const limit = input.limit ?? 80;
  const results: FliunoResult[] = [];

  if (input.scope !== "files") {
    for (const command of input.commands) {
      if (command.id === input.excludedCommandId) continue;
      const recentIndex = input.recentCommands.indexOf(command.id);
      const score = input.query
        ? fuzzyScore(`${command.title} ${command.category} ${command.id}`, input.query)
        : recentIndex >= 0
          ? 220 - recentIndex
          : input.scope === "commands"
            ? 20
            : -1;
      if (score < 0) continue;
      results.push({
        id: `command:${command.id}`,
        kind: "command",
        command,
        title: command.title,
        description: command.category,
        score,
        recent: recentIndex >= 0,
      });
    }
  }

  if (input.scope !== "commands") {
    for (const file of input.files) {
      const recentIndex = input.recentFiles.indexOf(file.path);
      const openIndex = input.openFiles.indexOf(file.path);
      const score = input.query
        ? fuzzyScore(`${file.name} ${file.relativePath}`, input.query) + (openIndex >= 0 ? 12 : 0)
        : openIndex >= 0
          ? 240 - openIndex
          : recentIndex >= 0
            ? 210 - recentIndex
            : input.scope === "files"
              ? 10
              : -1;
      if (score < 0) continue;
      results.push({
        id: `file:${file.path}`,
        kind: "file",
        file,
        title: file.name,
        description: file.relativePath,
        score,
        recent: recentIndex >= 0 || openIndex >= 0,
      });
    }
  }

  return results
    .sort(
      (left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"),
    )
    .slice(0, limit);
}
