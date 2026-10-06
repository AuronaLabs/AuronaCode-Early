import assert from "node:assert/strict";

export function validateReleaseScope(audit, carryoverDocument) {
  assert.match(audit.freezeDate ?? "", /^\d{4}-\d{2}-\d{2}$/, "Release freeze date has not been recorded");
  const unfinished = audit.items.filter((item) => item.status !== "verified");
  if (!audit.releaseScope) {
    assert.equal(unfinished.length, 0, `Release blocked by: ${unfinished.map((item) => item.id).join(", ")}`);
    assert.ok(audit.productionUpdaterEvidence && audit.productionMarketplaceEvidence && audit.candidateArtifactEvidence,
      "Production/candidate evidence is missing");
    return;
  }
  const scope = audit.releaseScope;
  assert.equal(scope.decision, "formal-release-with-carryover", "Unsupported release scope decision");
  assert.equal(scope.approvedOn, audit.freezeDate, "Release scope approval must match the freeze date");
  assert.equal(audit.version, "0.4.14", "This scope approval only applies to 0.4.14");
  assert.equal(scope.nextVersion, "0.4.15", "Carryover must target the next 0.4.x version");
  assert.equal(scope.decisionDocument, "Docs/0.4.14-Release-Decision.md");
  assert.equal(scope.carryoverDocument, "Docs/0.4.15-Carryover-Plan.md");
  assert.deepEqual([...scope.carryoverIds].sort(), unfinished.map((item) => item.id).sort(),
    "Every unfinished item must be explicitly carried over exactly once");
  const documented = [...carryoverDocument.matchAll(/^\| (P[0-3]-\d{2}) \|/gm)].map((match) => match[1]);
  assert.deepEqual(documented.sort(), [...scope.carryoverIds].sort(), "Carryover document must account for every deferred item");
  for (const item of unfinished) {
    assert.ok(item.implementation.length && item.notes.length, `${item.id} needs implementation and remaining work`);
    assert.notEqual(item.status, "pending", `${item.id} has not been implemented`);
  }
}
