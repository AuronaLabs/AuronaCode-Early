use std::time::Duration;

pub const REGISTERED_REDIRECT_URI: &str = "http://127.0.0.1/oauth/callback";
pub(crate) const CALLBACK_PATH: &str = "/oauth/callback";
pub(crate) const KEYRING_SERVICE: &str = "cc.aurona.code.account";
pub(crate) const KEYRING_REFRESH_TOKEN: &str = "aurona-account-refresh-token";
pub(crate) const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);
pub(crate) const MAX_CALLBACK_REQUEST_BYTES: usize = 16 * 1024;

/// Normalizes a configured OAuth client id. The id is case-sensitive and must
/// be exactly what the authorization server registered; surrounding whitespace
/// or an empty value means "not configured".
pub(crate) fn sanitize_client_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|configured| !configured.is_empty())
        .map(str::to_owned)
}

/// The build-time Aurona Account public client id. It is injected from the
/// repository-root `.env` (local development) or from the workflow environment
/// (CI/release); the source tree contains no fallback so every developer and
/// fork registers and fills in their own public client.
pub(crate) fn client_id_from_build_env() -> Option<String> {
    sanitize_client_id(option_env!("AURONA_ACCOUNT_CLIENT_ID"))
}

#[derive(Debug, Clone)]
pub struct AccountProviderConfig {
    pub enabled: bool,
    pub client_id: Option<String>,
    pub discovery_url: String,
    pub expected_issuer: String,
    pub scopes: Vec<String>,
    pub allow_insecure_loopback_provider: bool,
}

impl Default for AccountProviderConfig {
    fn default() -> Self {
        let allow_insecure_loopback_provider = cfg!(debug_assertions)
            && matches!(
                option_env!("AURONA_ACCOUNT_ALLOW_INSECURE_LOOPBACK_PROVIDER"),
                Some("1") | Some("true") | Some("TRUE")
            );
        Self {
            // Aurona Code is a public client. Development and production use
            // the same registered public client id so a user's account and
            // authorization are identical in both environments.
            enabled: cfg!(feature = "aurona-account"),
            client_id: client_id_from_build_env(),
            discovery_url: option_env!("AURONA_ACCOUNT_DISCOVERY_URL")
                .unwrap_or("https://auth.aurona.cc/.well-known/openid-configuration")
                .to_owned(),
            expected_issuer: option_env!("AURONA_ACCOUNT_EXPECTED_ISSUER")
                .unwrap_or("https://auth.aurona.cc")
                .to_owned(),
            scopes: vec![
                "openid".into(),
                "profile".into(),
                "email".into(),
                "offline_access".into(),
            ],
            allow_insecure_loopback_provider,
        }
    }
}
