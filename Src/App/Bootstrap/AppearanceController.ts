import { resolveConfiguration } from "../../Core/Configuration";
import { EventBus } from "../../Foundation/EventBus";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { UserConfig } from "../../Foundation/Types/Config";
import { useGlassStore } from "../../UI/Core/GlassManager";
import { applyAccentTheme, applyLiquidTexture } from "../ThemeAccent";

export function applyResponsiveDensity(density?: UserConfig["density"]): void {
  const root = document.documentElement;
  if (density && density !== "default") {
    root.dataset.density = density;
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  root.dataset.density =
    window.innerWidth < 940 || window.innerHeight < 680 || dpr >= 1.75
      ? "compact"
      : window.innerWidth > 1600 && window.innerHeight > 900 && dpr <= 1.25
        ? "comfortable"
        : "regular";
}

export function applyUserAppearance(config: Readonly<UserConfig>): void {
  const value = resolveConfiguration(config);
  const root = document.documentElement;
  root.classList.toggle(
    "dark",
    value.theme === "dark" ||
      (value.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches),
  );
  applyAccentTheme(value.accentTheme);
  applyLiquidTexture(value.liquidTexture);
  applyResponsiveDensity(value.density);
  if (value.boldText) root.dataset.boldText = "true";
  else delete root.dataset.boldText;
  if (value.interfaceFontSize !== "default") root.dataset.fontSize = value.interfaceFontSize;
  else delete root.dataset.fontSize;
  root.style.setProperty("--EditorFontSize", `${value.editorFontSize}px`);
  root.style.setProperty("--EditorLineHeight", `${value.editorLineHeight}px`);
  root.style.setProperty("--EditorTabSize", String(value.editorTabSize));
  root.style.setProperty(
    "--EditorCursorSmooth",
    value.editorCursorSmoothCaret ? "smooth" : "normal",
  );
  root.style.setProperty("--TerminalFontSize", `${value.terminalFontSize}px`);
  useGlassStore.getState().setIntensity(value.appearance.glassIntensity);
}

export async function startAppearanceController(): Promise<() => void> {
  let config = await UserConfigStore.get();
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => applyUserAppearance(config);
  const resize = () => applyResponsiveDensity(config.density);
  update();
  const unsubscribe = UserConfigStore.subscribe((next) => {
    const previous = config;
    config = next;
    update();
    if (
      Object.keys(next).some(
        (key) =>
          key.startsWith("editor") &&
          next[key as keyof UserConfig] !== previous[key as keyof UserConfig],
      )
    )
      EventBus.emit("settings:editor-changed");
  });
  media.addEventListener("change", update);
  window.addEventListener("resize", resize);
  return () => {
    unsubscribe();
    media.removeEventListener("change", update);
    window.removeEventListener("resize", resize);
  };
}
