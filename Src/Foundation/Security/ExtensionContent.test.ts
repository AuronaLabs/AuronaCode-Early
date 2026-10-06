import {
  extensionSvgDataUrl,
  sanitizeExtensionDocument,
  sanitizeExtensionSvg,
} from "./ExtensionContent";

describe("extension content boundaries", () => {
  it("keeps SVG geometry while removing executable and remote resources", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><iframe src="https://evil.test"/></foreignObject><image href="https://evil.test/a"/><path d="M0 0L10 10" fill="url(https://evil.test/paint)" onclick="alert(1)"/></svg>`;
    const clean = sanitizeExtensionSvg(source);
    expect(clean).toContain("M0 0L10 10");
    expect(clean).not.toMatch(/script|foreignObject|onload|onclick|evil\.test|iframe|<image/i);
    expect(extensionSvgDataUrl(source)).toMatch(/^data:image\/svg\+xml/);
  });

  it("rejects oversized and excessively complex SVG", () => {
    expect(sanitizeExtensionSvg("x".repeat(256 * 1024 + 1))).toBeNull();
    expect(sanitizeExtensionSvg(`<svg>${"<path/>".repeat(4097)}</svg>`)).toBeNull();
  });

  it("puts the host CSP first and removes external CSS, forms and navigation", () => {
    const clean = sanitizeExtensionDocument(
      `<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><style>@import "https://evil.test/a.css";body{background:url(https://evil.test/a)}</style></head><body><form action="https://evil.test"><input></form><a href="javascript:alert(1)" ping="https://evil.test">link</a><img src="https://evil.test/a"><p style="background: u\\72l(https://evil.test/a)">safe</p><script>alert(1)</script></body></html>`,
    );
    const document = new DOMParser().parseFromString(clean, "text/html");
    expect(document.head.firstElementChild?.getAttribute("http-equiv")).toBe(
      "Content-Security-Policy",
    );
    expect(document.querySelectorAll("meta")).toHaveLength(1);
    expect(clean).not.toMatch(/evil\.test|javascript:|<form|<input|<script/i);
    expect(document.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(document.querySelector("p")?.getAttribute("style")).toBe("");
  });

  it("preserves safe theme styles and only bounded embedded raster images", () => {
    const clean = sanitizeExtensionDocument(
      '<html><head><style>p{color:var(--AuronaText);padding:4px}</style></head><body><img src="data:image/png;base64,AAAA"><img src="data:image/svg+xml;base64,PHN2Zz4="><p style="font-weight:600">hello</p></body></html>',
    );
    expect(clean).toContain("var(--AuronaText)");
    const document = new DOMParser().parseFromString(clean, "text/html");
    expect(document.querySelectorAll("img[src]")).toHaveLength(1);
    expect(document.querySelector("p")?.getAttribute("style")).toContain("font-weight:600");
  });
});
