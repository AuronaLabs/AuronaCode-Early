import { useEffect, useState } from "react";
import { ConfigurationService, resolveConfiguration } from "../../../Core/Configuration";
import { UserConfigStore } from "../../../Foundation/Storage/UserConfigStore";
import type { AccentThemeId, UserConfig } from "../../../Foundation/Types/Config";
import { useGlassStore } from "../../../UI/Core/GlassManager";
import { showToast } from "../../../UI/Feedback/Toast";

/** Read projection only. Persistence and application of preferences have separate owners. */
export function useWorkbenchPreferences() {
  const [config, setConfig] = useState(() => resolveConfiguration({}));
  const intensity = useGlassStore((state) => state.intensity);
  const setIntensity = useGlassStore((state) => state.setIntensity);
  useEffect(() => {
    let active = true;
    let changed = false;
    const update = (next: UserConfig) => {
      if (active) {
        changed = true;
        setConfig(resolveConfiguration(next));
      }
    };
    const unsubscribe = UserConfigStore.subscribe(update);
    void UserConfigStore.get()
      .then((next) => {
        if (active && !changed) setConfig(resolveConfiguration(next));
      })
      .catch((error) => {
        if (active) showToast(String(error), "error");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const save = (patch: Partial<UserConfig>) => {
    void ConfigurationService.save(patch);
  };
  const editorValue = (
    key: "editorFontSize" | "editorLineHeight" | "editorTabSize",
    value: string,
  ) => setConfig((current) => ({ ...current, [key]: Number(value) }));
  return {
    theme: config.theme,
    accentTheme: config.accentTheme,
    liquidTexture: config.liquidTexture,
    density: config.density,
    boldText: config.boldText,
    interfaceFontSize: config.interfaceFontSize,
    muteNonCriticalToasts: config.muteNonCriticalToasts,
    toastDuration: config.toastDuration,
    fliunoOpenMode: config.fliuno.openMode,
    proxyMode: config.network.proxyMode,
    proxyUrl: config.network.proxyUrl,
    intensity,
    setIntensity,
    editorFontSize: String(config.editorFontSize),
    editorLineHeight: String(config.editorLineHeight),
    editorTabSize: String(config.editorTabSize),
    editorWordWrap: config.editorWordWrap,
    setEditorFontSize: (value: string) => editorValue("editorFontSize", value),
    setEditorLineHeight: (value: string) => editorValue("editorLineHeight", value),
    setEditorTabSize: (value: string) => editorValue("editorTabSize", value),
    setEditorWordWrap: (value: string) =>
      setConfig((current) => ({ ...current, editorWordWrap: value === "off" ? "off" : "on" })),
    handleThemeChange: (value: NonNullable<UserConfig["theme"]>) => save({ theme: value }),
    handleAccentThemeChange: (value: AccentThemeId) => save({ accentTheme: value }),
    handleLiquidTextureChange: (value: boolean) => save({ liquidTexture: value }),
    handleDensityChange: (value: NonNullable<UserConfig["density"]>) => save({ density: value }),
    handleBoldTextChange: (value: boolean) => save({ boldText: value }),
    handleInterfaceFontSizeChange: (value: NonNullable<UserConfig["interfaceFontSize"]>) =>
      save({ interfaceFontSize: value }),
    handleMuteNonCriticalChange: (value: boolean) => save({ muteNonCriticalToasts: value }),
    handleToastDurationChange: (value: number) => save({ toastDuration: value }),
    handleFliunoOpenModeChange: (value: "sidebar" | "editorTab") => {
      void ConfigurationService.saveSection("fliuno", { openMode: value });
    },
    handleProxyModeChange: (value: "system" | "custom" | "none") => {
      void ConfigurationService.saveSection("network", { proxyMode: value });
    },
    handleProxyUrlChange: (value: string) => {
      setConfig((current) => ({ ...current, network: { ...current.network, proxyUrl: value } }));
      void ConfigurationService.saveSection("network", { proxyUrl: value })
        .then(async (saved) => {
          if (!saved) setConfig(resolveConfiguration(await UserConfigStore.get()));
        })
        .catch(console.error);
    },
    handleGlassIntensityCommit: (value: number) => {
      void ConfigurationService.saveSection("appearance", { glassIntensity: value })
        .then(async (saved) => {
          if (!saved)
            setIntensity(
              resolveConfiguration(await UserConfigStore.get()).appearance.glassIntensity,
            );
        })
        .catch(console.error);
    },
  };
}
