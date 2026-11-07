/** Guard the migrated Rust domains without pretending to validate the full Rust module graph. */
export function checkRustDomainBoundaries(modules) {
  const violations = [];
  for (const { path, source } of modules) {
    if (!/^(workspace|git|editor|extensions\/runtime)\//.test(path) || /\/tests\.rs$/.test(path)) continue;
    if (/commands\s*::\s*(?:fs|git)\s*::/.test(source)) {
      violations.push(`${path}: workspace and Git capabilities belong to their domain, not commands`);
    }
    if (!/\/ipc\.rs$/.test(path) && /#\s*\[\s*tauri::command\b/.test(source)) {
      violations.push(`${path}: Tauri command adapters belong to ipc.rs`);
    }
  }
  return violations;
}
