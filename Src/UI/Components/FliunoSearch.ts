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
      titleRanges: Array<[number, number]>;
      descriptionRanges: Array<[number, number]>;
    }
  | {
      id: string;
      kind: "file";
      file: WorkspaceFileEntry;
      title: string;
      description: string;
      score: number;
      recent: boolean;
      titleRanges: Array<[number, number]>;
      descriptionRanges: Array<[number, number]>;
    };

export interface ParsedFliunoQuery {
  scope: FliunoScope;
  query: string;
  explicitScope: boolean;
}

interface SearchField {
  text: string;
  weight: number;
  surface?: "title" | "description";
}

interface TokenMatch {
  score: number;
  ranges: Array<[number, number]>;
}

interface QueryMatch {
  score: number;
  titleRanges: Array<[number, number]>;
  descriptionRanges: Array<[number, number]>;
}

const SYNONYMS: Array<{ pattern: RegExp; words: string[] }> = [
  {
    pattern: /设置|偏好|选项|settings|preferences|prefs/i,
    words: ["settings", "设置", "偏好", "preferences", "prefs"],
  },
  { pattern: /保存|save/i, words: ["save", "保存"] },
  { pattern: /打开|open/i, words: ["open", "打开"] },
  { pattern: /关闭|close/i, words: ["close", "关闭"] },
  { pattern: /运行|run/i, words: ["run", "运行"] },
  { pattern: /调试|debug/i, words: ["debug", "调试"] },
  { pattern: /搜索|search/i, words: ["search", "搜索"] },
  { pattern: /终端|terminal/i, words: ["terminal", "终端"] },
  { pattern: /文件|file/i, words: ["file", "文件"] },
  { pattern: /格式化|format/i, words: ["format", "格式化"] },
  { pattern: /刷新|refresh/i, words: ["refresh", "刷新"] },
  { pattern: /复制|copy/i, words: ["copy", "复制"] },
  { pattern: /粘贴|paste/i, words: ["paste", "粘贴"] },
  { pattern: /撤销|undo/i, words: ["undo", "撤销"] },
  { pattern: /重做|redo/i, words: ["redo", "重做"] },
  { pattern: /重命名|rename/i, words: ["rename", "重命名"] },
  { pattern: /删除|delete/i, words: ["delete", "删除"] },
  { pattern: /新建|创建|create|new/i, words: ["new", "新建", "create"] },
  { pattern: /更新|update/i, words: ["update", "更新"] },
  { pattern: /主题|theme/i, words: ["theme", "主题"] },
  { pattern: /字体|font/i, words: ["font", "字体"] },
  { pattern: /性能|performance|benchmark/i, words: ["performance", "性能", "benchmark"] },
  { pattern: /账户|账号|account/i, words: ["account", "账户", "账号"] },
];

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

const normalize = (value: string) => value.toLocaleLowerCase("zh-CN");

function boundaryScore(value: string, index: number): number {
  if (index === 0) return 2;
  const previous = value[index - 1] ?? "";
  if (/[\s/\\._-]/.test(previous)) return 2;
  if (/[a-z0-9]/.test(previous) && /[A-Z]/.test(value[index] ?? "")) return 1;
  return 0;
}

function acronymOf(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (/[A-Z]/.test(character)) result += character;
    else if (index > 0 && /[\s/\\._-]/.test(value[index - 1] ?? "") && /[a-z0-9]/.test(character)) {
      result += character;
    }
  }
  const first = value.match(/[a-zA-Z0-9]/)?.[0];
  if (first && !normalize(result).includes(first.toLocaleLowerCase("zh-CN"))) {
    result = first + result;
  }
  return normalize(result);
}

function matchToken(token: string, text: string): TokenMatch | null {
  const haystack = normalize(text);
  const direct = haystack.indexOf(token);
  if (direct >= 0) {
    const boundary = boundaryScore(text, direct);
    const lengthRatio = Math.min(1, token.length / Math.max(1, haystack.length));
    let score: number;
    if (direct === 0) score = 1000 + lengthRatio * 40;
    else if (boundary >= 1) score = 860 - direct * 0.2 + boundary * 10;
    else score = 700 - direct * 0.3;
    return { score, ranges: [[direct, direct + token.length]] };
  }

  let cursor = -1;
  let gaps = 0;
  let boundaries = 0;
  const ranges: Array<[number, number]> = [];
  for (const character of token) {
    const next = haystack.indexOf(character, cursor + 1);
    if (next < 0) return null;
    if (cursor >= 0) gaps += next - cursor - 1;
    boundaries += boundaryScore(text, next);
    ranges.push([next, next + 1]);
    cursor = next;
  }
  const coverage = token.length / Math.max(1, haystack.length);
  return {
    score: 380 + boundaries * 12 - gaps * 1.1 - cursor * 0.08 + coverage * 30,
    ranges,
  };
}

function mergeRanges(target: Array<[number, number]>, ranges: Array<[number, number]>) {
  for (const [start, end] of ranges) {
    const existing = target.find(([from, to]) => start <= to && from <= end);
    if (existing) {
      existing[0] = Math.min(existing[0], start);
      existing[1] = Math.max(existing[1], end);
    } else {
      target.push([start, end]);
    }
  }
  target.sort((left, right) => left[0] - right[0]);
}

function matchQuery(query: string, fields: SearchField[]): QueryMatch | null {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return { score: 0, titleRanges: [], descriptionRanges: [] };
  let total = 0;
  const titleRanges: Array<[number, number]> = [];
  const descriptionRanges: Array<[number, number]> = [];
  for (const token of tokens) {
    let best: {
      score: number;
      ranges: Array<[number, number]>;
      surface?: "title" | "description";
    } | null = null;
    for (const field of fields) {
      const match = matchToken(token, field.text);
      if (!match) continue;
      const weighted = match.score * field.weight;
      if (!best || weighted > best.score) {
        best = { score: weighted, ranges: match.ranges, surface: field.surface };
      }
    }
    if (!best) return null;
    total += best.score;
    if (best.surface === "title") mergeRanges(titleRanges, best.ranges);
    else if (best.surface === "description") mergeRanges(descriptionRanges, best.ranges);
  }
  return { score: total, titleRanges, descriptionRanges };
}

function keywordsFor(command: CommandDefinition<unknown>): string[] {
  const source = `${command.title} ${command.id} ${command.category ?? ""}`;
  const found: string[] = [];
  for (const { pattern, words } of SYNONYMS) {
    if (pattern.test(source)) found.push(...words);
  }
  return [...new Set(found)];
}

export function fuzzyScore(value: string, query: string): number {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  let total = 0;
  for (const token of tokens) {
    const match = matchToken(token, value);
    if (!match) return -1;
    total += match.score;
  }
  return total;
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
  const limit = input.limit ?? 100;
  const query = input.query.trim();
  const results: FliunoResult[] = [];

  if (input.scope !== "files") {
    for (const command of input.commands) {
      if (command.id === input.excludedCommandId) continue;
      const recentIndex = input.recentCommands.indexOf(command.id);
      let score = 0;
      let titleRanges: Array<[number, number]> = [];
      let descriptionRanges: Array<[number, number]> = [];
      if (query) {
        const fields: SearchField[] = [
          { text: command.title, weight: 1, surface: "title" },
          { text: command.id, weight: 1 },
          { text: command.category ?? "", weight: 0.5, surface: "description" },
          { text: acronymOf(command.id), weight: 0.9 },
          { text: acronymOf(command.title), weight: 0.9 },
          ...keywordsFor(command).map<SearchField>((word) => ({ text: word, weight: 0.8 })),
        ];
        const match = matchQuery(query, fields);
        if (!match) continue;
        score = match.score;
        titleRanges = match.titleRanges;
        descriptionRanges = match.descriptionRanges;
        if (recentIndex >= 0) score += Math.max(0, 16 - recentIndex * 2);
      } else {
        score = recentIndex >= 0 ? 220 - recentIndex : input.scope === "commands" ? 20 : -1;
      }
      if (score < 0) continue;
      results.push({
        id: `command:${command.id}`,
        kind: "command",
        command,
        title: command.title,
        description: command.category,
        score,
        recent: recentIndex >= 0,
        titleRanges,
        descriptionRanges,
      });
    }
  }

  if (input.scope !== "commands") {
    for (const file of input.files) {
      const recentIndex = input.recentFiles.indexOf(file.path);
      const openIndex = input.openFiles.indexOf(file.path);
      const segments = file.relativePath.split(/[\\/]/).filter(Boolean).length;
      const depthBonus = Math.max(0, 24 - segments * 6);
      const nameWithoutExtension = file.name.replace(/\.[^.]+$/, "");
      let score = 0;
      let titleRanges: Array<[number, number]> = [];
      let descriptionRanges: Array<[number, number]> = [];
      if (query) {
        const fields: SearchField[] = [
          { text: file.name, weight: 1, surface: "title" },
          { text: nameWithoutExtension, weight: 0.95, surface: "title" },
          { text: file.relativePath, weight: 0.7, surface: "description" },
          { text: acronymOf(file.relativePath), weight: 0.9 },
        ];
        const match = matchQuery(query, fields);
        if (!match) continue;
        score = match.score;
        titleRanges = match.titleRanges;
        descriptionRanges = match.descriptionRanges;
        score +=
          depthBonus * 0.6 +
          (openIndex >= 0 ? 14 : 0) +
          (recentIndex >= 0 ? Math.max(0, 10 - recentIndex * 2) : 0);
      } else {
        score =
          openIndex >= 0
            ? 240 - openIndex
            : recentIndex >= 0
              ? 210 - recentIndex
              : input.scope === "files"
                ? 10 + depthBonus * 0.5
                : -1;
      }
      if (score < 0) continue;
      results.push({
        id: `file:${file.path}`,
        kind: "file",
        file,
        title: file.name,
        description: file.relativePath,
        score,
        recent: recentIndex >= 0 || openIndex >= 0,
        titleRanges,
        descriptionRanges,
      });
    }
  }

  return results
    .sort(
      (left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"),
    )
    .slice(0, limit);
}
