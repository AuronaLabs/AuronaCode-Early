use regex::Regex;
use std::sync::LazyLock;

static URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\b(?:https?|socks5?)://[^\s<>"']+"#).unwrap());
static AUTH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(bearer|basic)\s+[a-z0-9+/=_\-.]+").unwrap());
static SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\b(token|access_token|api[_-]?key|password|passwd|secret|authorization)(\s*[=:]\s*)[^\s&,;"']+"#).unwrap()
});

pub fn redact(input: &str) -> String {
    let urls = URL.replace_all(input, |captures: &regex::Captures<'_>| {
        let Ok(mut url) = url::Url::parse(&captures[0]) else {
            return "[redacted-url]".to_string();
        };
        let _ = url.set_username("");
        let _ = url.set_password(None);
        url.set_query(None);
        url.set_fragment(None);
        url.to_string()
    });
    let auth = AUTH.replace_all(&urls, "$1 [redacted]");
    SECRET.replace_all(&auth, "$1$2[redacted]").into_owned()
}

#[cfg(test)]
mod tests {
    #[test]
    fn git_credentials_and_proxy_errors_are_redacted() {
        let result = super::redact("fatal: https://alice:secret@host.test/repo?token=abc#fragment Bearer ey.secret Basic c2VjcmV0 password=hidden api_key=apikey");
        for secret in [
            "alice", "secret", "abc", "fragment", "ey.", "c2VjcmV0", "hidden", "apikey",
        ] {
            assert!(!result.contains(secret), "{result}");
        }
        assert!(result.contains("host.test/repo"));
    }
}
