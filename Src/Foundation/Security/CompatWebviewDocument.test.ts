import { buildCompatWebviewDocument } from "./CompatWebviewDocument";

describe("compatible webview document", () => {
  it("installs CSP before author code, keeps scripts isolated and prevents external navigation", () => {
    const html = buildCompatWebviewDocument(
      '<meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"><script src="https://evil.test/x.js">window.author=true</script><iframe src="https://evil.test"></iframe><p>你好</p>',
      true,
      "channel",
      "dark",
      { text: "</script><script>evil</script>" },
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.head.firstElementChild?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(doc.querySelector("base,iframe,script[src],meta[http-equiv=refresh]")).toBeNull();
    expect(doc.querySelector("meta")?.getAttribute("content")).toContain("connect-src 'none'");
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(doc.querySelector("script")?.textContent).toContain("\\u003c/script>");
    expect(doc.body.classList.contains("vscode-dark")).toBe(true);
  });
  it("does not enable author scripts for a static webview", () => {
    const html = buildCompatWebviewDocument(
      "<script>alert(1)</script><p>static</p>",
      false,
      "channel",
      "light",
      undefined,
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("static");
  });
});
