/** Canonical IDs used by the Marketplace and extension IPC boundary. */
export const LEGACY_EXTENSION_ID_ALIASES = {
  "aurona.markdown": "auronalabs.markdown",
  "aurona.planner": "auronalabs.planner",
} as const;

export type LegacyExtensionId = keyof typeof LEGACY_EXTENSION_ID_ALIASES;

export function canonicalExtensionId(id: string): string {
  return LEGACY_EXTENSION_ID_ALIASES[id as LegacyExtensionId] ?? id;
}

export function isLegacyExtensionId(id: string): id is LegacyExtensionId {
  return id in LEGACY_EXTENSION_ID_ALIASES;
}

/**
 * Canonicalize and deduplicate extension-shaped records without discarding
 * records that cannot be understood. Canonical records take precedence when
 * both a legacy and canonical key are present.
 */
export function migrateExtensionRecords<T extends { id: string }>(records: T[]): T[] {
  const migrated = new Map<string, T>();
  for (const record of records) {
    if (!record || typeof record.id !== "string") continue;
    const id = canonicalExtensionId(record.id);
    const existing = migrated.get(id);
    if (existing && existing.id === id && record.id !== id) continue;
    migrated.set(id, id === record.id ? record : { ...record, id });
  }
  return [...migrated.values()];
}
