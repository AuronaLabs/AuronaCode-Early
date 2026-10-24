import { useMemo } from "react";
import { sanitizeExtensionSvg } from "../../Foundation/Security/ExtensionContent";

/** Sanitized inline SVG inherits currentColor while preserving explicit brand colors. */
export function ExtensionGlyph({
  source,
  size = 22,
  className = "",
}: {
  source: string;
  size?: number;
  className?: string;
}) {
  const clean = useMemo(() => sanitizeExtensionSvg(source), [source]);
  if (!clean) return null;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
  const paints = [...clean.matchAll(/(?:fill|stroke|stop-color)="([^"]+)"/g)].map(
    (match) => match[1],
  );
  const monochrome =
    paints.some((paint) => paint === "currentColor") &&
    paints.every((paint) => paint === "none" || paint === "currentColor");
  if (!monochrome) return <img src={url} alt="" width={size} height={size} className={className} />;
  return (
    <span
      aria-hidden="true"
      className={`extension-glyph inline-flex shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: "currentColor",
        mask: `url("${url}") center / contain no-repeat`,
        WebkitMask: `url("${url}") center / contain no-repeat`,
      }}
    />
  );
}
