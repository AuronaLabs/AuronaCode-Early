#!/usr/bin/env node
/**
 * i18n 检测工具：key 树 diff / 占位符一致性 / 硬编码中文扫描。
 * 零运行时依赖：locale 文件只有 import type / 类型注解 / export type 三类 TS 语法，
 * 做轻量剥离后经 data: URL 动态 import 得到对象。
 *
 * 用法：node scripts/i18n-check.mjs [--strict]
 *   默认：key 树/占位符错误返回非零（结构性问题必须阻塞），硬编码中文仅警告；
 *   --strict：硬编码中文也返回非零（观察期结束后可切到此模式进 CI 阻塞）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCALES_DIR = join(root, "Src", "Foundation", "I18n", "locales");
const SRC_DIR = join(root, "Src");

const LOCALES = [
  { id: "zh-CN", file: "zh-CN.ts", symbol: "zhCN" },
  { id: "zh-Hant", file: "zh-Hant.ts", symbol: "zhHant" },
  { id: "en", file: "en.ts", symbol: "en" },
  { id: "de", file: "de.ts", symbol: "de" },
  { id: "it", file: "it.ts", symbol: "it" },
  { id: "ja", file: "ja.ts", symbol: "ja" },
];

const strict = process.argv.includes("--strict");
let failures = 0;
let warnings = 0;

/** 极简 TS 剥离（locale 文件结构受限，见文件头注释） */
function stripTs(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*import type\b/.test(line) && !/^\s*export type\b/.test(line))
    .join("\n")
    .replace(/:\s*LocaleMessages\s*=/, " =");
}

async function loadLocale(entry) {
  const js = stripTs(readFileSync(join(LOCALES_DIR, entry.file), "utf8"));
  const encoded = Buffer.from(js, "utf8").toString("base64");
  const mod = await import(`data:text/javascript;base64,${encoded}`);
  return mod[entry.symbol];
}

function collectKeys(obj, prefix = "", output = []) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") collectKeys(value, path, output);
    else output.push(path);
  }
  return output;
}

function getAtPath(obj, path) {
  return path.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

console.log("== i18n 检查 ==");

// 1) key 树 diff（zh-CN 为基准）
const messagesByLocale = new Map();
for (const entry of LOCALES) {
  messagesByLocale.set(entry.id, await loadLocale(entry));
}
const base = messagesByLocale.get("zh-CN");
const baseKeys = new Set(collectKeys(base));

for (const entry of LOCALES.slice(1)) {
  const keys = new Set(collectKeys(messagesByLocale.get(entry.id)));
  for (const key of baseKeys) {
    if (!keys.has(key)) {
      console.error(`  ✗ [${entry.id}] 缺少键 ${key}`);
      failures += 1;
    }
  }
  for (const key of keys) {
    if (!baseKeys.has(key)) {
      console.error(`  ✗ [${entry.id}] 多余键 ${key}`);
      failures += 1;
    }
  }
}
console.log(`  key 树：${baseKeys.size} 键 × ${LOCALES.length} 语言`);

// 2) 占位符一致性
const PLACEHOLDER = /\{(\w+)\}/g;
for (const key of baseKeys) {
  const expected = new Set(
    [...String(getAtPath(base, key) ?? "").matchAll(PLACEHOLDER)].map((match) => match[1]),
  );
  if (!expected.size) continue;
  for (const entry of LOCALES.slice(1)) {
    const value = String(getAtPath(messagesByLocale.get(entry.id), key) ?? "");
    const actual = new Set([...value.matchAll(PLACEHOLDER)].map((match) => match[1]));
    for (const name of expected) {
      if (!actual.has(name)) {
        console.error(`  ✗ [${entry.id}] ${key} 缺少占位符 {${name}}`);
        failures += 1;
      }
    }
    for (const name of actual) {
      if (!expected.has(name)) {
        console.error(`  ✗ [${entry.id}] ${key} 多余占位符 {${name}}`);
        failures += 1;
      }
    }
  }
}

// 3) 硬编码中文扫描（字符串字面量；注释行跳过；locale 文件与测试文件排除）
// 文件白名单：纯中文数据文件（changelog 内容）、强调色 label、同义词表、macOS 菜单数据
// 行级跳过：title/category/description/label 字段为 fallback 数据（titleKey 等优先机制接管）
const WHITELIST_FILES = ["ChangelogData.ts", "ThemeAccent.ts", "FliunoCore.ts", "MacMenu.ts"];
const SKIP_LINE_FIELDS = /^(title|category|description|label):\s*["'`]/;
const CJK = /[\u3400-\u9fff\u3040-\u30ff]/;
const STRING_WITH_CJK = /(['"`])[^'"`\n]*[\u3400-\u9fff][^'"`\n]*\1/g;

function walk(dir, output = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full === LOCALES_DIR) continue;
    try {
      if (statSync(full).isDirectory()) walk(full, output);
      else if (/\.(tsx?|mjs)$/.test(name)) output.push(full);
    } catch {
      // 权限/符号链接等异常直接跳过
    }
  }
  return output;
}

function* iterLines(source) {
  let start = 0;
  while (start <= source.length) {
    const index = source.indexOf("\n", start);
    if (index < 0) {
      yield source.slice(start);
      return;
    }
    yield source.slice(start, index);
    start = index + 1;
  }
}

const scannedFiles = walk(SRC_DIR).filter(
  (file) => !file.includes(`${sep}Test${sep}`) && !/\.test\.(ts|tsx)$/.test(file),
);
const hardcoded = [];
for (const file of scannedFiles) {
  if (WHITELIST_FILES.some((name) => file.endsWith(name))) continue;
  const source = readFileSync(file, "utf8");
  const lines = [...iterLines(source)];
  // keywords 数组内的字符串是中英文检索词（合法），整块跳过
  let inKeywords = false;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("keywords:")) {
      inKeywords = !trimmed.includes("]");
      continue;
    }
    if (inKeywords) {
      if (trimmed.includes("]")) inKeywords = false;
      continue;
    }
    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    ) {
      continue;
    }
    if (SKIP_LINE_FIELDS.test(trimmed)) continue;
    for (const match of lines[index].matchAll(STRING_WITH_CJK)) {
      if (CJK.test(match[0])) {
        hardcoded.push(
          `${relative(root, file).replaceAll("\\", "/")}:${index + 1}: ${match[0].slice(0, 60)}`,
        );
      }
    }
  }
}
if (hardcoded.length) {
  for (const item of hardcoded) console.error(`  ⚠ 疑似硬编码中文：${item}`);
  warnings += hardcoded.length;
}

console.log(
  `\n结果：${failures} 个结构错误，${warnings} 个硬编码中文警告（扫描 ${scannedFiles.length} 个文件）`,
);
const exitCode = failures > 0 || (strict && warnings > 0) ? 1 : 0;
if (exitCode !== 0) console.error("i18n 检查未通过");
else console.log("i18n 检查通过");
process.exit(exitCode);
