import {
  type CommandDefinition,
  getCommandCategory,
  getCommandTitle,
} from "../../Extension/CommandRegistry";
import { type I18nKey, LocaleService } from "../../Foundation/I18n";
import {
  type WorkspaceFileEntry,
  WorkspaceSearchIPC,
} from "../../Foundation/IPC/WorkspaceSearchCommands";
import {
  SETTING_CATEGORY_KEYS,
  type SettingCategory,
  searchSettings,
} from "../Settings/SettingRegistry";

export type FliunoScope = "all" | "commands" | "files" | "settings" | "symbols" | "content";

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
  if (trimmed.startsWith("#")) {
    return { scope: "symbols", query: trimmed.slice(1).trimStart(), explicitScope: true };
  }
  if (trimmed.startsWith(":")) {
    return { scope: "content", query: trimmed.slice(1).trimStart(), explicitScope: true };
  }
  return { scope: selectedScope, query: value.trim(), explicitScope: false };
}

const PREFIX_SCOPE: Record<string, FliunoScope> = {
  ">": "commands",
  "@": "files",
  "#": "symbols",
  ":": "content",
};

/**
 * 用户主动切换 Scope 时，若输入仍带有旧的显式 Prefix，则移除该 Prefix，
 * 保证视觉 Scope 与实际搜索 Scope 一致。
 */
export function queryForScope(value: string, nextScope: FliunoScope): string {
  const trimmed = value.trimStart();
  const prefix = trimmed[0] ?? "";
  if (prefix in PREFIX_SCOPE && PREFIX_SCOPE[prefix] !== nextScope) {
    return trimmed.slice(1).trimStart();
  }
  return value;
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

function commandKeywords(command: CommandDefinition<unknown>): string[] {
  const source = `${command.title} ${command.id} ${command.category ?? ""}`;
  const found: string[] = [];
  for (const { pattern, words } of SYNONYMS) {
    if (pattern.test(source)) found.push(...words);
  }
  return [...new Set(found)];
}

export interface SearchField {
  text: string;
  weight: number;
  surface?: "title" | "description";
}

export interface TokenMatch {
  score: number;
  ranges: Array<[number, number]>;
}

export interface QueryMatch {
  score: number;
  titleRanges: Array<[number, number]>;
  descriptionRanges: Array<[number, number]>;
}

const normalize = (value: string) => value.toLocaleLowerCase("zh-CN");

function boundaryScore(value: string, index: number): number {
  if (index === 0) return 2;
  const previous = value[index - 1] ?? "";
  if (/[\s/\\._-]/.test(previous)) return 2;
  if (/[a-z0-9]/.test(previous) && /[A-Z]/.test(value[index] ?? "")) return 1;
  return 0;
}

export function acronymOf(value: string): string {
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

export function mergeRanges(target: Array<[number, number]>, ranges: Array<[number, number]>) {
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

export function matchQuery(query: string, fields: SearchField[]): QueryMatch | null {
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

export type FliunoCoreResultKind = "command" | "file" | "setting" | "symbol" | "content";

export interface FliunoCoreResult {
  id: string;
  kind: FliunoCoreResultKind;
  title: string;
  description: string;
  score: number;
  recent: boolean;
  titleRanges: Array<[number, number]>;
  descriptionRanges: Array<[number, number]>;
  action: "openFile" | "executeCommand" | "openSettings" | "revealSymbol" | "revealContent";
  targetPath?: string;
  targetLine?: number;
  commandId?: string;
  settingId?: string;
  settingCategory?: SettingCategory;
}

export interface FliunoCoreContext {
  query: string;
  scope: FliunoScope;
  commands: CommandDefinition<unknown>[];
  files: WorkspaceFileEntry[];
  recentCommands: string[];
  recentFiles: string[];
  openFiles: string[];
  activeFilePath?: string;
  activeLanguage?: string;
  openFileTabs?: Array<{ path: string; language?: string }>;
  workspaceRoot?: string;
  excludedCommandId: string;
  contentCaseSensitive?: boolean;
  contentRegex?: boolean;
  requestId: string;
  limit?: number;
}

interface LspSymbolNode {
  name?: string;
  detail?: string;
  range?: { start: { line: number } };
  children?: LspSymbolNode[];
}

function flattenSymbols(nodes: LspSymbolNode[], output: LspSymbolNode[] = []): LspSymbolNode[] {
  for (const node of nodes) {
    output.push(node);
    if (node.children) flattenSymbols(node.children, output);
  }
  return output;
}

const fileBaseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export async function searchFliuno(context: FliunoCoreContext): Promise<FliunoCoreResult[]> {
  const limit = context.limit ?? 120;
  const query = context.query.trim();
  const results: FliunoCoreResult[] = [];

  if (context.scope === "all" || context.scope === "commands") {
    for (const command of context.commands) {
      if (command.id === context.excludedCommandId) continue;
      const recentIndex = context.recentCommands.indexOf(command.id);
      let score = 0;
      let titleRanges: Array<[number, number]> = [];
      let descriptionRanges: Array<[number, number]> = [];
      if (query) {
        const fields: SearchField[] = [
          { text: getCommandTitle(command), weight: 1, surface: "title" },
          { text: command.id, weight: 1 },
          { text: getCommandCategory(command), weight: 0.5, surface: "description" },
          { text: acronymOf(command.id), weight: 0.9 },
          { text: acronymOf(getCommandTitle(command)), weight: 0.9 },
          ...commandKeywords(command).map<SearchField>((word) => ({ text: word, weight: 0.8 })),
        ];
        const match = matchQuery(query, fields);
        if (!match) continue;
        score = match.score;
        titleRanges = match.titleRanges;
        descriptionRanges = match.descriptionRanges;
        if (recentIndex >= 0) score += Math.max(0, 16 - recentIndex * 2);
      } else {
        score = recentIndex >= 0 ? 220 - recentIndex : context.scope === "commands" ? 20 : -1;
      }
      if (score < 0) continue;
      results.push({
        id: `command:${command.id}`,
        kind: "command",
        title: getCommandTitle(command),
        description: getCommandCategory(command),
        score,
        recent: recentIndex >= 0,
        titleRanges,
        descriptionRanges,
        action: "executeCommand",
        commandId: command.id,
      });
    }
  }

  if (context.scope === "all" || context.scope === "files") {
    for (const file of context.files) {
      const recentIndex = context.recentFiles.indexOf(file.path);
      const openIndex = context.openFiles.indexOf(file.path);
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
              : context.scope === "files"
                ? 10 + depthBonus * 0.5
                : -1;
      }
      if (score < 0) continue;
      results.push({
        id: `file:${file.path}`,
        kind: "file",
        title: file.name,
        description: file.relativePath,
        score,
        recent: recentIndex >= 0 || openIndex >= 0,
        titleRanges,
        descriptionRanges,
        action: "openFile",
        targetPath: file.path,
      });
    }
  }

  if (context.scope === "all" || context.scope === "settings") {
    const localeTitle = (key: I18nKey) => LocaleService.translate(key);
    for (const setting of searchSettings(query, localeTitle)) {
      const title = LocaleService.translate(setting.titleKey);
      const description = setting.descriptionKey
        ? LocaleService.translate(setting.descriptionKey)
        : LocaleService.translate(SETTING_CATEGORY_KEYS[setting.category]);
      const match = matchQuery(query, [
        { text: title, weight: 1, surface: "title" },
        { text: description, weight: 0.7, surface: "description" },
        { text: setting.id, weight: 0.9 },
        ...setting.keywords.map<SearchField>((word) => ({ text: word, weight: 0.8 })),
      ]);
      if (!match) continue;
      results.push({
        id: `setting:${setting.id}`,
        kind: "setting",
        title,
        description,
        score: match.score,
        recent: false,
        titleRanges: match.titleRanges,
        descriptionRanges: match.descriptionRanges,
        action: "openSettings",
        settingId: setting.id,
        settingCategory: setting.category,
      });
    }
  }

  if (
    (context.scope === "all" || context.scope === "symbols") &&
    (context.activeFilePath || (context.openFileTabs?.length ?? 0) > 0)
  ) {
    try {
      const { LspClient } = await import("../Language/LspClient");
      const { DocumentSymbolService } = await import("../Language/DocumentSymbolService");
      const client = LspClient.getInstance();
      const tabs = context.openFileTabs?.length
        ? context.openFileTabs
        : context.activeFilePath
          ? [{ path: context.activeFilePath, language: context.activeLanguage }]
          : [];
      const seen = new Set<string>();
      for (const tab of tabs) {
        const language = tab.language ?? context.activeLanguage;
        if (!tab.path || !language || !client.supports(language, "documentSymbols")) continue;
        try {
          const symbols = (await DocumentSymbolService.get(language, tab.path)) as unknown;
          const nodes = flattenSymbols(Array.isArray(symbols) ? (symbols as LspSymbolNode[]) : []);
          for (const node of nodes) {
            const name = node.name ?? "";
            if (!name) continue;
            const line = node.range ? node.range.start.line + 1 : undefined;
            const dedupeKey = `${tab.path}:${name}:${line ?? 0}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            const match = matchQuery(query, [
              { text: name, weight: 1, surface: "title" },
              { text: node.detail ?? "", weight: 0.6, surface: "description" },
              { text: tab.path, weight: 0.4, surface: "description" },
            ]);
            if (!match) continue;
            results.push({
              id: `symbol:${dedupeKey}`,
              kind: "symbol",
              title: name,
              description: `${fileBaseName(tab.path)}${line ? `:${line}` : ""}${
                node.detail ? ` · ${node.detail}` : ""
              }`,
              score: match.score + 20,
              recent: false,
              titleRanges: match.titleRanges,
              descriptionRanges: match.descriptionRanges,
              action: "revealSymbol",
              targetPath: tab.path,
              targetLine: line,
            });
          }
        } catch {
          // 单个文件符号索引失败不影响其他文件。
        }
      }
    } catch {
      // 符号索引失败时静默跳过，不影响其他 Provider。
    }
  }

  if ((context.scope === "all" || context.scope === "content") && context.workspaceRoot && query) {
    try {
      const response = await WorkspaceSearchIPC.searchText(
        context.workspaceRoot,
        query,
        context.contentCaseSensitive ?? false,
        context.contentRegex ?? false,
        context.requestId,
      );
      for (const item of response.results.slice(0, 300)) {
        const title = fileBaseName(item.file_path);
        const description = item.match_text.trimStart().slice(0, 120);
        let titleRanges: Array<[number, number]> = [];
        let descriptionRanges: Array<[number, number]> = [];
        let score = 0;
        if (context.contentRegex) {
          // 正则模式下 backend 是唯一过滤事实来源；这里只负责展示与排序，不再做二次 fuzzy 过滤。
          score = 500;
          try {
            const flags = context.contentCaseSensitive ? "" : "i";
            const matcher = new RegExp(query, flags);
            const match = matcher.exec(description);
            if (match?.index !== undefined) {
              descriptionRanges = [[match.index, match.index + Math.max(1, match[0].length)]];
            }
          } catch {
            // 无效正则已由 backend 处理；展示层忽略高亮即可。
          }
        } else {
          const match = matchQuery(query, [
            { text: title, weight: 0.5, surface: "title" },
            { text: description, weight: 0.9, surface: "description" },
          ]);
          if (!match) continue;
          score = match.score;
          titleRanges = match.titleRanges;
          descriptionRanges = match.descriptionRanges;
        }
        const root = context.workspaceRoot?.replace(/[\\/]+$/, "") ?? "";
        results.push({
          id: `content:${item.file_path}:${item.line_number}:${item.index}`,
          kind: "content",
          title,
          description,
          score: score + 10,
          recent: false,
          titleRanges,
          descriptionRanges,
          action: "revealContent",
          targetPath: `${root}/${item.file_path}`,
          targetLine: item.line_number,
        });
      }
    } catch {
      // 内容搜索失败时静默跳过。
    }
  }

  return results
    .sort(
      (left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"),
    )
    .slice(0, limit);
}

export class FliunoSearchSession {
  private generation = 0;
  private results: FliunoCoreResult[] = [];
  private lastQuery = "";
  private lastRequestId: string | null = null;

  async search(context: Omit<FliunoCoreContext, "requestId">): Promise<FliunoCoreResult[]> {
    const generation = ++this.generation;
    const requestId = `fliuno-${Date.now()}-${generation}`;
    if (this.lastRequestId && this.lastRequestId !== requestId) {
      const previous = this.lastRequestId;
      WorkspaceSearchIPC.cancel(previous).catch(() => undefined);
    }
    this.lastRequestId = requestId;
    const next = await searchFliuno({ ...context, requestId });
    if (generation !== this.generation) return [];
    this.results = next;
    this.lastQuery = context.query;
    return next;
  }

  cancel(): void {
    this.generation += 1;
    if (this.lastRequestId) {
      const requestId = this.lastRequestId;
      WorkspaceSearchIPC.cancel(requestId).catch(() => undefined);
      this.lastRequestId = null;
    }
  }

  getResults(): FliunoCoreResult[] {
    return this.results;
  }

  getLastQuery(): string {
    return this.lastQuery;
  }
}
