import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseMarkdown, validateDocuments } from "./lib/markdown-documents.mjs";

function fixture(files, run) {
  const root = mkdtempSync(path.join(tmpdir(), "aurona-docs-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), source);
    }
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("checks nested links, encoded paths and Unicode or duplicate heading slugs", () => {
  fixture({
    "README.md": "[guide](Docs/Local%20Development.md#中文标题)\n[duplicate](Docs/Local%20Development.md#quick-start-1)",
    "Docs/Local Development.md": "# 中文标题\n## Quick Start\n## Quick Start\n[back](../README.md)",
  }, (root) => assert.deepEqual(validateDocuments(root, ["README.md", "Docs/Local Development.md"]).errors, []));
});

test("checks reference destinations and distinguishes missing files from missing headings", () => {
  fixture({ "README.md": "[missing][guide]\n\n[guide]: absent.md\n\n[anchor](#absent)\n# Present" }, (root) => {
    const { errors } = validateDocuments(root, ["README.md"]);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /missing target/);
    assert.match(errors[1], /missing heading/);
  });
});

test("does not treat code examples, escaped text or remote URLs as local links", () => {
  fixture({ "README.md": "```md\n[example](absent.md)\n```\n`[inline](absent.md)`\n[remote](https://example.com/absent.md)\n\\[literal](absent.md)" }, (root) => {
    assert.deepEqual(validateDocuments(root, ["README.md"]).errors, []);
  });
});

test("rejects uneven GFM tables and unclosed fences", () => {
  const result = parseMarkdown("| A | B |\n| --- | --- |\n| one |\n\n~~~ts\nconst pending = true;");
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /table/);
  assert.match(result.errors[1], /unclosed code fence/);
});

test("checks images and rejects local links outside the repository", () => {
  fixture({ "README.md": "![missing](image.png)\n[outside](../private.md)" }, (root) => {
    const { errors } = validateDocuments(root, ["README.md"]);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /missing target/);
    assert.match(errors[1], /escapes repository/);
  });
});

test("catches path case errors on Windows before case-sensitive CI runs", () => {
  fixture({ "README.md": "[guide](docs/Guide.md)", "Docs/Guide.md": "# Guide" }, (root) => {
    const { errors } = validateDocuments(root, ["README.md"]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /path case mismatch/);
  });
});
