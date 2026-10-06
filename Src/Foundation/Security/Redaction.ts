export function redactDiagnostic(input: string): string {
  const urls = input.replace(/\b(?:https?|socks5?):\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "[redacted-url]";
    }
  });
  return urls
    .replace(/\b(bearer|basic)\s+[a-z0-9+/=_.-]+/gi, "$1 [redacted]")
    .replace(
      /\b(token|access_token|api[_-]?key|password|passwd|secret|authorization)(\s*[=:]\s*)[^\s&,;"']+/gi,
      "$1$2[redacted]",
    );
}
