/**
 * Compatibility export for feature callers. The canonicalization logic lives
 * in Foundation because IPC clients may depend on it without importing a
 * feature module.
 */
export * from "../../Foundation/Types/ExtensionId";
