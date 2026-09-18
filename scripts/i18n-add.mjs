#!/usr/bin/env node
/**
 * i18n 添加向导：一条命令把同一个键写入全部 6 个 locale 文件。
 * 文本插桩（非重序列化）：保持既有格式/注释/键序，只插入新键。
 *
 * 用法：
 *   node scripts/i18n-add.mjs settings.definitions.foo.bar \
 *     --zh-CN="中文" --zh-Hant="繁體" --en="English" --de="Deutsch" --it="Italiano" --ja="日本語"
 *
 * 规则：
 *   - 键已存在时拒绝（防止误覆盖），可用 --force 覆盖
 *   - 插入位置：目标父块内最后一个直接子键之后
 *   - 统一 LF 写盘
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCALES_DIR = join(root, "Src", "Foundation", "I18n", "locales");

const LOCALES = [
  { id: "zh-CN", file: "zh-CN.ts" },
  { id: "zh-Hant", file: "zh-Hant.ts" },
  { id: "en", file: "en.ts" },
  { id: "de", file: "de.ts" },
  { id: "it", file: "it.ts" },
  { id: "ja", file: "ja.ts" },
];

const args = process.argv.slice(2);
const force = args.includes("--force");
const keyPath = args.find((arg) => !arg.startsWith("--"));
if (!keyPath || !/^[\w-]+(\.[\w-]+)+$/.test(keyPath)) {
  console.error(
    '用法: node scripts/i18n-add.mjs <a.b.c> --zh-CN="..." --zh-Hant="..." --en="..." --de="..." --it="..." --ja="..."',
  );
  process.exit(1);
}
const parts = keyPath.split(".");
const leaf = parts.at(-1);

const values = new Map();
for (const arg of args) {
  const match = arg.match(/^--([\w-]+)=(.*)$/s);
  if (match) values.set(match[1], match[2]);
}
for (const { id } of LOCALES) {
  if (!values.has(id) || !values.get(id)) {
    console.error(`缺少 --${id}="<翻译>" 参数`);
    process.exit(1);
  }
}

/**
 * 在 source 中定位 parts 逐级下钻后的父块插入点。
 * 返回 { insertAt, indent, missing }：insertAt 为插入偏移（父块闭合括号前），
 * missing 为源文件中尚不存在的尾部路径段（需要创建嵌套块），indent 为插入处缩进。
 */
function locateInsertPoint(source, pathParts) {
  let searchFrom = 0;
  let childIndent = "      ";
  let blockClose = -1;
  let missing = [];
  for (let index = 0; index < pathParts.length; index += 1) {
    const part = pathParts[index];
    const openMatch = new RegExp(`\\n(\\s*)"?(?:${part})"?\\s*:\\s*\\{`).exec(
      source.slice(searchFrom),
    );
    if (!openMatch) {
      missing = pathParts.slice(index);
      break;
    }
    const openBrace = searchFrom + openMatch.index + openMatch[0].length - 1;
    let depth = 0;
    let closeBrace = -1;
    for (let cursor = openBrace; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          closeBrace = cursor;
          break;
        }
      }
    }
    if (closeBrace < 0) return null;
    searchFrom = openBrace + 1;
    childIndent = `${openMatch[1]}  `;
    blockClose = closeBrace;
  }
  if (blockClose < 0) {
    // 整条路径都不存在（顶层新组）：插入到根对象闭合括号前
    const trimmedEnd = source.replace(/\s+$/, "").lastIndexOf("}");
    if (trimmedEnd < 0) return null;
    blockClose = trimmedEnd;
    childIndent = "  ";
    missing = pathParts;
  }
  return { insertAt: blockClose, indent: childIndent, missing };
}

/** 构造嵌套块文本：missing 逐层开括号，最内层放 leaf */
function buildNested(missing, leaf, value, indent) {
  const [head, ...rest] = missing;
  if (rest.length) {
    return `${indent}"${head}": {\n${buildNested(rest, leaf, value, `${indent}  `)}\n${indent}},\n`;
  }
  return `${indent}"${head}": {\n${indent}  "${leaf}": ${value},\n${indent}},\n`;
}

function hasLeaf(source, pathParts, from, to) {
  const leaf = pathParts.at(-1);
  const pattern = new RegExp(`\\n\\s*"?(?:${leaf})"?\\s*:`);
  return pattern.test(source.slice(from, to));
}

let failed = false;
for (const { id, file } of LOCALES) {
  const filePath = join(LOCALES_DIR, file);
  const source = readFileSync(filePath, "utf8");
  const parentParts = parts.slice(0, -1);
  const point = locateInsertPoint(source, parentParts);
  if (!point) {
    console.error(`  ✗ [${id}] 未找到父块 ${parentParts.join(".")}`);
    failed = true;
    continue;
  }
  if (!force && hasLeaf(source, parts, 0, source.length)) {
    console.error(`  ✗ [${id}] 键 ${keyPath} 已存在（--force 覆盖）`);
    failed = true;
    continue;
  }
  const value = JSON.stringify(values.get(id));
  const insertion = point.missing.length
    ? buildNested(point.missing, leaf, value, point.indent)
    : `${point.indent}"${leaf}": ${value},\n`;
  const updated = source.slice(0, point.insertAt) + insertion + source.slice(point.insertAt);
  writeFileSync(filePath, updated.replaceAll("\r\n", "\n"));
  console.log(`  ✓ [${id}] ${file} 已插入 ${keyPath}`);
}

process.exit(failed ? 1 : 0);
