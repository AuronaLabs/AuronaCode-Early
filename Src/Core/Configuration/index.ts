import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { SecurityPreferences, UserConfig } from "../../Foundation/Types/Config";

export const SECURITY_DEFAULTS: Readonly<Required<SecurityPreferences>> = Object.freeze({
  requireExtensionSignature: true,
  autoTrustWorkspaceLanguageServers: false,
  requireLocalProcessApproval: true,
  requireWorkspaceApproval: true,
  requireAiEndpointApproval: true,
  requirePackageInstallApproval: true,
  requireExtensionExecutionApproval: true,
  requireDeleteApproval: true,
  requireGitDiscardApproval: true,
});

export const CONFIGURATION_DEFAULTS = Object.freeze({
  theme: "system" as const,
  accentTheme: "aurora" as const,
  liquidTexture: false,
  density: "default" as const,
  boldText: false,
  interfaceFontSize: "default" as const,
  muteNonCriticalToasts: false,
  toastDuration: 4000,
  editorFontSize: 14,
  editorLineHeight: 24,
  editorTabSize: 2,
  editorWordWrap: "on" as const,
  editorMinimap: false,
  editorCapsuleEnabled: true,
  editorCursorSmoothCaret: true,
  editorSmoothScrolling: true,
  terminalFontSize: 13,
});

/** Effective values only: old configuration files are read without being rewritten. */
export function resolveConfiguration(config: Readonly<UserConfig>) {
  const values = { ...CONFIGURATION_DEFAULTS, ...config };
  for (const key of Object.keys(CONFIGURATION_DEFAULTS) as Array<
    keyof typeof CONFIGURATION_DEFAULTS
  >) {
    if (values[key] === undefined) Object.assign(values, { [key]: CONFIGURATION_DEFAULTS[key] });
  }
  return {
    ...values,
    appearance: { ...config.appearance, glassIntensity: config.appearance?.glassIntensity ?? 50 },
    security: Object.fromEntries(
      Object.entries(SECURITY_DEFAULTS).map(([key, fallback]) => [
        key,
        config.security?.[key as keyof SecurityPreferences] ?? fallback,
      ]),
    ) as Required<SecurityPreferences>,
    fliuno: { ...config.fliuno, openMode: config.fliuno?.openMode ?? ("sidebar" as const) },
    network: {
      ...config.network,
      proxyMode: config.network?.proxyMode ?? ("system" as const),
      proxyUrl: config.network?.proxyUrl ?? "",
    },
  };
}

export const ConfigurationService = {
  /** UI fire-and-forget writes report failures through UserConfigStore.onWriteError. */
  async save(patch: Partial<UserConfig>): Promise<boolean> {
    try {
      await UserConfigStore.set(patch);
      return true;
    } catch {
      return false;
    }
  },
  async saveSection<K extends "appearance" | "network" | "fliuno" | "security">(
    section: K,
    patch: Partial<NonNullable<UserConfig[K]>>,
  ): Promise<boolean> {
    try {
      await UserConfigStore.update((current) => ({ [section]: { ...current[section], ...patch } }));
      return true;
    } catch {
      return false;
    }
  },
};
