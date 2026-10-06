import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Read data literals through the TypeScript parser; formatting is not a contract.
export function readExportedLiteral(file, name, references = {}) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!initializer) throw new Error(`Missing data export ${name} in ${file}`);
  function value(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value);
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) throw new Error("Only literal properties are allowed");
      return [property.name.text ?? property.name.getText(source), value(property.initializer)];
    }));
    if (ts.isIdentifier(node) && Object.hasOwn(references, node.text)) return references[node.text];
    throw new Error(`Unsupported data expression: ${node.getText(source)}`);
  }
  return value(initializer);
}

export function readChangelog(root) {
  const audit = readExportedLiteral(path.join(root, "Src/Features/Settings/AuditChangelogData.ts"), "AUDIT_0414_CHANGELOG");
  return readExportedLiteral(path.join(root, "Src/Features/Settings/ChangelogData.ts"), "CHANGELOG_DATA", { AUDIT_0414_CHANGELOG: audit });
}
