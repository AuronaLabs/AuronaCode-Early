import { describe, expect, it } from "vitest";
import { readThemeSnapshot } from "../../../Foundation/Theme/ThemeSnapshot";
import { composeExtensionDocument, tryParseDeclarativeUI } from "./ExtensionViewDocument";

describe("extension document composition", () => {
  it("shares effective theme tokens and keeps a single transparent content layer", () => {
    const html = composeExtensionDocument(
      "<html><body><!--AURONA_RENDER_SLOT--><aside><!--AURONA_STATUS_SLOT--></aside></body></html>",
      {
        html: '<p onclick="alert(1)">preview</p><script>bad()</script>',
        diagnostics: ['<img src=x onerror="bad()">'],
        revision: 1,
      },
      readThemeSnapshot({ theme: "dark" }),
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.documentElement.dataset.theme).toBe("dark");
    expect(doc.body.querySelector("script")).toBeNull();
    expect(doc.body.querySelector("p")?.hasAttribute("onclick")).toBe(false);
    expect(doc.body.querySelector("aside")?.textContent).toContain("<img src=x");
    expect(doc.body.querySelector("img")).toBeNull();
    expect(doc.head.textContent).toContain("background:transparent!important");
    expect(
      doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    ).toContain("script-src 'none'");
  });
  it("rejects malformed and unrelated declarative JSON", () => {
    for (const input of ["<html></html>", "{invalid}", '{"foo":"bar"}'])
      expect(tryParseDeclarativeUI(input)).toBeNull();
  });
});
