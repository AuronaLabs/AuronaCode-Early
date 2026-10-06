import * as css from "css-tree";
import DOMPurify from "dompurify";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const MAX_SVG_ELEMENTS = 4096;
const SVG_TAGS = [
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "title",
  "desc",
];
const SVG_ATTRIBUTES = [
  "xmlns",
  "viewBox",
  "width",
  "height",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "points",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "transform",
  "id",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "clip-path",
  "clip-rule",
  "preserveAspectRatio",
];

export function sanitizeExtensionSvg(source: string): string | null {
  if (new TextEncoder().encode(source).length > MAX_SVG_BYTES) return null;
  const clean = DOMPurify.sanitize(source, {
    PARSER_MEDIA_TYPE: "application/xhtml+xml",
    ALLOWED_TAGS: SVG_TAGS,
    ALLOWED_ATTR: SVG_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const root = doc.documentElement;
  if (root.localName !== "svg" || doc.querySelector("parsererror")) return null;
  if (root.querySelectorAll("*").length > MAX_SVG_ELEMENTS) return null;
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      // Only local paint-server references may survive in an image resource.
      if (/url\s*\(/i.test(attribute.value) && !/^url\(#[a-zA-Z0-9_-]+\)$/.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
      if (attribute.value.length > 32 * 1024) return null;
    }
  }
  return new XMLSerializer().serializeToString(root);
}

export function extensionSvgDataUrl(source: string): string | null {
  const clean = sanitizeExtensionSvg(source);
  return clean ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}` : null;
}

function safeCss(source: string, context: "stylesheet" | "declarationList"): string {
  try {
    const ast = css.parse(source, { context });
    let unsafe = false;
    css.walk(ast, (node) => {
      if (node.type === "Url" || node.type === "Raw") unsafe = true;
      if (node.type === "Atrule" && /^(import|font-face|namespace)$/i.test(node.name))
        unsafe = true;
      if (node.type === "Function" && /^(expression|image-set|-webkit-image-set)$/i.test(node.name))
        unsafe = true;
    });
    return unsafe ? "" : css.generate(ast);
  } catch {
    return "";
  }
}

export function sanitizeExtensionDocument(source: string): string {
  if (new TextEncoder().encode(source).length > MAX_HTML_BYTES)
    throw new Error("Extension view exceeds 2 MiB");
  const clean = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "textarea",
      "select",
      "button",
      "link",
      "base",
      "meta",
      "svg",
      "math",
    ],
    FORBID_ATTR: ["srcset", "action", "formaction", "ping", "target"],
    ALLOW_DATA_ATTR: true,
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    element.removeAttribute("href");
    const src = element.getAttribute("src");
    if (
      src &&
      (element.tagName !== "IMG" ||
        !/^data:image\/(png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(src))
    )
      element.removeAttribute("src");
    const style = element.getAttribute("style");
    if (style) element.setAttribute("style", safeCss(style, "declarationList"));
    if (element.tagName === "STYLE")
      element.textContent = safeCss(element.textContent ?? "", "stylesheet");
  }
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
  doc.head.prepend(policy);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
