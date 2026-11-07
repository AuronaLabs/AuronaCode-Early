export interface ThemeSnapshot {
  mode: "dark" | "light";
  accent: string;
  text: string;
  muted: string;
  surface: string;
  surfaceHover: string;
  border: string;
  fontSize: string;
  fontWeight: string;
}

/** Restrict CSS interpolation to one color value, including modern computed color functions. */
function safeColor(value: string | undefined, fallback: string): string {
  const color = value?.trim() ?? "";
  return color.length < 256 &&
    /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix)\([a-z0-9\s.,%()+\-/]+\))$/i.test(
      color,
    )
    ? color
    : fallback;
}

export function readThemeSnapshot(
  options: { theme?: string; accentColor?: string; fontSize?: string; fontWeight?: string } = {},
): ThemeSnapshot {
  const root = document.documentElement;
  const mode =
    options.theme === "dark" || options.theme === "light"
      ? options.theme
      : root.classList.contains("dark")
        ? "dark"
        : "light";
  const dark = mode === "dark";
  const style = getComputedStyle(root);
  const color = (token: string, fallback: string) =>
    safeColor(style.getPropertyValue(token), fallback);
  const size = options.fontSize ?? root.dataset.fontSize;
  return {
    mode,
    accent: safeColor(options.accentColor, color("--color-accent", "#2563eb")),
    text: color("--color-text-primary", dark ? "#cbd5e1" : "#222222"),
    muted: color("--color-text-muted", dark ? "#9ca3af" : "#667085"),
    surface: color("--material-surface", dark ? "rgba(255,255,255,.055)" : "rgba(255,255,255,.48)"),
    surfaceHover: color(
      "--surface-hover",
      dark ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.72)",
    ),
    border: color("--color-border", dark ? "rgba(255,255,255,.12)" : "rgba(31,41,55,.10)"),
    fontSize:
      size === "compact"
        ? "12px"
        : size === "comfortable"
          ? "14px"
          : size === "large"
            ? "15px"
            : "13px",
    fontWeight: options.fontWeight === "bold" || root.dataset.boldText === "true" ? "600" : "400",
  };
}

export function extensionThemeStyle(theme: ThemeSnapshot): string {
  return `:root{color-scheme:${theme.mode};--AuronaAccent:${theme.accent};--AuronaText:${theme.text};--AuronaMuted:${theme.muted};--AuronaSurface:${theme.surface};--AuronaSurfaceHover:${theme.surfaceHover};--AuronaBorder:${theme.border};--AuronaFontSize:${theme.fontSize};--AuronaFontWeight:${theme.fontWeight};--vscode-editor-background:transparent;--vscode-editor-foreground:${theme.text};--vscode-descriptionForeground:${theme.muted};--vscode-focusBorder:${theme.accent};--vscode-button-background:${theme.accent};--vscode-panel-border:${theme.border};--vscode-input-background:${theme.surface};--vscode-input-foreground:${theme.text}}html,body{background:transparent!important;color:var(--AuronaText);font-size:var(--AuronaFontSize);font-weight:var(--AuronaFontWeight)}`;
}
