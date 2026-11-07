import { useEffect, useMemo, useReducer } from "react";
import { readThemeSnapshot } from "../../Foundation/Theme/ThemeSnapshot";

export function useThemeSnapshot(
  theme?: string,
  accentColor?: string,
  fontSize?: string,
  fontWeight?: string,
) {
  const [revision, refresh] = useReducer((value) => value + 1, 0);
  useEffect(() => {
    const observer = new MutationObserver(() => refresh());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-font-size", "data-bold-text"],
    });
    return () => observer.disconnect();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision captures host CSS token changes
  return useMemo(
    () => readThemeSnapshot({ theme, accentColor, fontSize, fontWeight }),
    [theme, accentColor, fontSize, fontWeight, revision],
  );
}
