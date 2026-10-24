/** Isolated VS Code HTML. Scripts run only inside an opaque-origin sandbox. */
export function buildCompatWebviewDocument(
  html: string,
  scripts: boolean,
  channel: string,
  theme: string,
  state: unknown,
): string {
  if (new TextEncoder().encode(html).length > 1024 * 1024) throw new Error("Webview exceeds 1 MiB");
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of doc.querySelectorAll("meta,base,iframe,object,embed,link")) node.remove();
  for (const node of doc.querySelectorAll("script")) {
    if (!scripts) node.remove();
    else {
      node.removeAttribute("src");
      node.setAttribute("nonce", nonce);
    }
  }
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = `default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`;
  doc.head.prepend(policy);
  doc.body.classList.add(theme === "dark" ? "vscode-dark" : "vscode-light");
  const style = doc.createElement("style");
  style.textContent = `:root{color-scheme:${theme === "dark" ? "dark" : "light"};--vscode-editor-background:transparent;--vscode-editor-foreground:${theme === "dark" ? "#cbd5e1" : "#222222"};--vscode-focusBorder:#3b82f6}html,body{background:transparent;color:var(--vscode-editor-foreground);font-family:system-ui;font-size:13px}`;
  doc.head.insertBefore(style, policy.nextSibling);
  if (scripts) {
    const bootstrap = doc.createElement("script");
    bootstrap.nonce = nonce;
    const safe = (value: unknown) => JSON.stringify(value ?? null).replaceAll("<", "\\u003c");
    bootstrap.textContent = `(()=>{const channel=${safe(channel)};let state=${safe(state)};let acquired=false;globalThis.acquireVsCodeApi=()=>{if(acquired)throw new Error('VS Code API already acquired');acquired=true;return Object.freeze({postMessage:value=>parent.postMessage({channel,kind:'message',value},'*'),getState:()=>state,setState:value=>{state=value;parent.postMessage({channel,kind:'state',value},'*');return value}})};addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==channel)return;dispatchEvent(new MessageEvent('message',{data:event.data.value}));});})();`;
    doc.head.insertBefore(bootstrap, style.nextSibling);
  }
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
