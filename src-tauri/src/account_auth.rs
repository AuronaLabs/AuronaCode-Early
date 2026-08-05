use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use rand::{distr::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Arc, time::Duration};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::{oneshot, Mutex},
};
use url::Url;

mod config;
use config::{
    AccountProviderConfig, CALLBACK_PATH, CALLBACK_TIMEOUT, KEYRING_REFRESH_TOKEN, KEYRING_SERVICE,
    MAX_CALLBACK_REQUEST_BYTES, REGISTERED_REDIRECT_URI,
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountAuthPhase {
    Disabled,
    SignedOut,
    Discovering,
    AwaitingCallback,
    ExchangingCode,
    SignedIn,
    Refreshing,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub subject: String,
    pub name: Option<String>,
    pub preferred_username: Option<String>,
    pub email: Option<String>,
    pub email_verified: Option<bool>,
    pub picture: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountAuthStatus {
    pub enabled: bool,
    pub registered_redirect_uri: &'static str,
    pub phase: AccountAuthPhase,
    pub profile: Option<AccountProfile>,
    pub expires_at_unix: Option<u64>,
    pub last_error: Option<AccountAuthError>,
    pub last_notice: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountAuthError {
    pub code: String,
    pub user_message: String,
    pub detail: String,
    pub recoverable: bool,
}

impl AccountAuthError {
    fn new(code: &str, user_message: &str, detail: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code: code.into(),
            user_message: user_message.into(),
            detail: detail.into(),
            recoverable,
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
struct DiscoveryDocument {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
    userinfo_endpoint: Option<String>,
    revocation_endpoint: Option<String>,
    code_challenge_methods_supported: Option<Vec<String>>,
    scopes_supported: Option<Vec<String>>,
    response_types_supported: Option<Vec<String>>,
    grant_types_supported: Option<Vec<String>>,
    token_endpoint_auth_methods_supported: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    token_type: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IdTokenClaims {
    iss: String,
    sub: String,
    aud: Audience,
    exp: u64,
    iat: u64,
    nonce: Option<String>,
    azp: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

impl Audience {
    fn values(&self) -> Vec<&str> {
        match self {
            Self::One(value) => vec![value],
            Self::Many(values) => values.iter().map(String::as_str).collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct UserInfoResponse {
    sub: String,
    name: Option<String>,
    preferred_username: Option<String>,
    email: Option<String>,
    email_verified: Option<bool>,
    picture: Option<String>,
}

struct CallbackPayload {
    state: String,
    code: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

struct RuntimeState {
    status: AccountAuthStatus,
    access_token: Option<String>,
    cancel: Option<oneshot::Sender<()>>,
    active_authorization: Option<u64>,
    next_authorization: u64,
}

enum AuthorizationCompletion {
    Completed,
    Cancelled,
    Failed(AccountAuthError),
}

enum BrowserCallbackResponse {
    Success,
    Cancelled,
    Failure,
}

pub struct AccountAuthService {
    config: AccountProviderConfig,
    http: reqwest::Client,
    runtime: Mutex<RuntimeState>,
}

impl Default for AccountAuthService {
    fn default() -> Self {
        Self::new(AccountProviderConfig::default())
    }
}

impl AccountAuthService {
    pub fn new(config: AccountProviderConfig) -> Self {
        let enabled = config.enabled && config.client_id.is_some();
        Self {
            config,
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15))
                .build()
                .expect("account HTTP client configuration is valid"),
            runtime: Mutex::new(RuntimeState {
                status: AccountAuthStatus {
                    enabled,
                    registered_redirect_uri: REGISTERED_REDIRECT_URI,
                    phase: if enabled {
                        AccountAuthPhase::SignedOut
                    } else {
                        AccountAuthPhase::Disabled
                    },
                    profile: None,
                    expires_at_unix: None,
                    last_error: None,
                    last_notice: None,
                },
                access_token: None,
                cancel: None,
                active_authorization: None,
                next_authorization: 0,
            }),
        }
    }

    pub async fn status(&self) -> AccountAuthStatus {
        self.runtime.lock().await.status.clone()
    }

    pub async fn start<R: Runtime>(
        self: &Arc<Self>,
        app: &AppHandle<R>,
    ) -> Result<(), AccountAuthError> {
        self.ensure_enabled()?;
        self.cancel().await;
        let (authorization_id, cancel_rx) = self.begin_authorization().await;

        let discovery = match self.discover().await {
            Ok(discovery) => discovery,
            Err(error) => {
                self.finish_authorization_failure(authorization_id, error.clone())
                    .await;
                return Err(error);
            }
        };
        if !self.is_active_authorization(authorization_id).await {
            return Ok(());
        }
        let listener = match TcpListener::bind(("127.0.0.1", 0)).await {
            Ok(listener) => listener,
            Err(error) => {
                let error = AccountAuthError::new(
                    "callback_bind_failed",
                    "无法准备安全的账户回调。",
                    error.to_string(),
                    true,
                );
                self.finish_authorization_failure(authorization_id, error.clone())
                    .await;
                return Err(error);
            }
        };
        if !self.is_active_authorization(authorization_id).await {
            return Ok(());
        }
        let port = match listener.local_addr() {
            Ok(address) => address.port(),
            Err(error) => {
                let error = AccountAuthError::new(
                    "callback_address_failed",
                    "无法读取账户回调地址。",
                    error.to_string(),
                    true,
                );
                self.finish_authorization_failure(authorization_id, error.clone())
                    .await;
                return Err(error);
            }
        };
        let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
        let verifier = random_secret(64);
        let state = random_secret(48);
        let nonce = random_secret(48);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let authorization_url =
            match self.authorization_url(&discovery, &redirect_uri, &state, &nonce, &challenge) {
                Ok(url) => url,
                Err(error) => {
                    self.finish_authorization_failure(authorization_id, error.clone())
                        .await;
                    return Err(error);
                }
            };
        if !self
            .set_authorization_phase(authorization_id, AccountAuthPhase::AwaitingCallback)
            .await
        {
            return Ok(());
        }

        if let Err(error) = app
            .opener()
            .open_url(authorization_url.as_str(), None::<&str>)
        {
            let error = AccountAuthError::new(
                "browser_open_failed",
                "无法打开系统浏览器。",
                error.to_string(),
                true,
            );
            self.finish_authorization_failure(authorization_id, error.clone())
                .await;
            return Err(error);
        }

        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let result = service
                .complete_authorization(
                    authorization_id,
                    listener,
                    cancel_rx,
                    discovery,
                    redirect_uri,
                    verifier,
                    state,
                    nonce,
                )
                .await;
            match result {
                AuthorizationCompletion::Completed => {}
                AuthorizationCompletion::Cancelled => {
                    service
                        .finish_authorization_cancelled(authorization_id)
                        .await;
                }
                AuthorizationCompletion::Failed(error) => {
                    service
                        .finish_authorization_failure(authorization_id, error)
                        .await;
                }
            }
        });
        Ok(())
    }

    pub async fn cancel(&self) {
        let mut runtime = self.runtime.lock().await;
        if let Some(cancel) = runtime.cancel.take() {
            let _ = cancel.send(());
        }
        runtime.active_authorization = None;
        if runtime.status.enabled && runtime.status.phase != AccountAuthPhase::SignedIn {
            runtime.status.phase = AccountAuthPhase::SignedOut;
            runtime.status.last_error = None;
            runtime.status.last_notice = Some("已取消授权。".into());
        }
    }

    pub async fn refresh(&self) -> Result<AccountAuthStatus, AccountAuthError> {
        self.ensure_enabled()?;
        self.set_phase(AccountAuthPhase::Refreshing).await;
        let refresh_token = read_refresh_token().map_err(|error| {
            AccountAuthError::new(
                "refresh_token_unavailable",
                "账户登录已过期，请重新登录。",
                error,
                true,
            )
        })?;
        let discovery = self.discover().await?;
        let client_id = self.client_id()?;
        let response = self
            .http
            .post(&discovery.token_endpoint)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token.as_str()),
                ("client_id", client_id),
            ])
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            let _ = delete_refresh_token();
            self.clear_session().await;
            return Err(AccountAuthError::new(
                "refresh_rejected",
                "账户授权已失效，请重新登录。",
                format!("token endpoint returned {status}: {detail}"),
                true,
            ));
        }
        let tokens: TokenResponse = response.json().await.map_err(protocol_error)?;
        validate_token_type(&tokens)?;
        self.accept_refreshed_tokens(&discovery, tokens).await?;
        Ok(self.status().await)
    }

    pub async fn restore(&self) -> Result<AccountAuthStatus, AccountAuthError> {
        self.ensure_enabled()?;
        if read_refresh_token().is_err() {
            self.clear_session().await;
            return Ok(self.status().await);
        }
        self.refresh().await
    }

    pub async fn logout(&self) -> Result<(), AccountAuthError> {
        self.cancel().await;
        if let Ok(refresh_token) = read_refresh_token() {
            if let Ok(discovery) = self.discover().await {
                if let Some(endpoint) = discovery.revocation_endpoint {
                    let client_id = self.client_id()?;
                    let _ = self
                        .http
                        .post(endpoint)
                        .form(&[
                            ("token", refresh_token.as_str()),
                            ("token_type_hint", "refresh_token"),
                            ("client_id", client_id),
                        ])
                        .send()
                        .await;
                }
            }
        }
        let _ = delete_refresh_token();
        self.clear_session().await;
        Ok(())
    }

    pub async fn shutdown(&self) {
        self.cancel().await;
        // Access and ID tokens are intentionally memory-only.
        self.runtime.lock().await.access_token = None;
    }

    fn ensure_enabled(&self) -> Result<(), AccountAuthError> {
        if !self.config.enabled || self.config.client_id.is_none() {
            return Err(AccountAuthError::new(
                "account_feature_disabled",
                "当前构建尚未配置 Aurona Account。",
                "The account feature is disabled or has no public client id.",
                false,
            ));
        }
        Ok(())
    }

    fn client_id(&self) -> Result<&str, AccountAuthError> {
        self.config.client_id.as_deref().ok_or_else(|| {
            AccountAuthError::new(
                "client_not_configured",
                "Aurona Account 尚未配置。",
                "Public OAuth client id is missing.",
                false,
            )
        })
    }

    async fn discover(&self) -> Result<DiscoveryDocument, AccountAuthError> {
        let response = self
            .http
            .get(&self.config.discovery_url)
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(AccountAuthError::new(
                "discovery_failed",
                "无法连接 Aurona Account。",
                format!("discovery returned HTTP {}", response.status()),
                true,
            ));
        }
        let discovery: DiscoveryDocument = response.json().await.map_err(protocol_error)?;
        self.validate_discovery(&discovery)?;
        Ok(discovery)
    }

    fn validate_discovery(&self, discovery: &DiscoveryDocument) -> Result<(), AccountAuthError> {
        let expected = normalized_origin(&self.config.expected_issuer)?;
        if normalized_origin(&discovery.issuer)? != expected {
            return Err(protocol_message(
                "OIDC issuer does not match the configured issuer",
            ));
        }
        for endpoint in [
            Some(discovery.authorization_endpoint.as_str()),
            Some(discovery.token_endpoint.as_str()),
            Some(discovery.jwks_uri.as_str()),
            discovery.userinfo_endpoint.as_deref(),
            discovery.revocation_endpoint.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            validate_provider_endpoint(
                endpoint,
                &expected,
                self.config.allow_insecure_loopback_provider,
            )?;
        }
        if !discovery
            .code_challenge_methods_supported
            .as_ref()
            .is_some_and(|methods| methods.iter().any(|method| method == "S256"))
        {
            return Err(protocol_message(
                "OIDC provider does not advertise PKCE S256",
            ));
        }
        if discovery.userinfo_endpoint.is_none() {
            return Err(protocol_message(
                "OIDC provider does not publish a UserInfo endpoint",
            ));
        }
        if discovery.revocation_endpoint.is_none() {
            return Err(protocol_message(
                "OIDC provider does not publish a token revocation endpoint",
            ));
        }
        if discovery
            .response_types_supported
            .as_ref()
            .is_some_and(|types| !types.iter().any(|value| value == "code"))
        {
            return Err(protocol_message(
                "OIDC provider does not support the authorization code response type",
            ));
        }
        if discovery
            .grant_types_supported
            .as_ref()
            .is_some_and(|types| !types.iter().any(|value| value == "authorization_code"))
        {
            return Err(protocol_message(
                "OIDC provider does not support the authorization_code grant",
            ));
        }
        if discovery
            .token_endpoint_auth_methods_supported
            .as_ref()
            .is_some_and(|methods| !methods.iter().any(|value| value == "none"))
        {
            return Err(protocol_message(
                "OIDC provider does not allow public clients at the token endpoint",
            ));
        }
        if let Some(scopes) = &discovery.scopes_supported {
            for required in &self.config.scopes {
                if !scopes.iter().any(|scope| scope == required) {
                    return Err(protocol_message(format!(
                        "OIDC provider does not advertise required scope `{required}`"
                    )));
                }
            }
        }
        Ok(())
    }

    fn authorization_url(
        &self,
        discovery: &DiscoveryDocument,
        redirect_uri: &str,
        state: &str,
        nonce: &str,
        challenge: &str,
    ) -> Result<Url, AccountAuthError> {
        let mut url = Url::parse(&discovery.authorization_endpoint).map_err(url_error)?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", self.client_id()?)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("scope", &self.config.scopes.join(" "))
            .append_pair("state", state)
            .append_pair("nonce", nonce)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256");
        Ok(url)
    }

    #[allow(clippy::too_many_arguments)]
    async fn complete_authorization(
        &self,
        authorization_id: u64,
        listener: TcpListener,
        mut cancel: oneshot::Receiver<()>,
        discovery: DiscoveryDocument,
        redirect_uri: String,
        verifier: String,
        expected_state: String,
        nonce: String,
    ) -> AuthorizationCompletion {
        let accepted = tokio::select! {
            _ = &mut cancel => return AuthorizationCompletion::Cancelled,
            result = tokio::time::timeout(CALLBACK_TIMEOUT, listener.accept()) => result,
        };
        let (mut stream, _) = match accepted {
            Ok(Ok(stream)) => stream,
            Ok(Err(error)) => {
                return AuthorizationCompletion::Failed(AccountAuthError::new(
                    "callback_failed",
                    "无法接收账户回调。",
                    error.to_string(),
                    true,
                ))
            }
            Err(_) => {
                return AuthorizationCompletion::Failed(AccountAuthError::new(
                    "callback_timeout",
                    "登录已超时。",
                    "No loopback callback was received within five minutes.",
                    true,
                ))
            }
        };
        let callback = match read_callback(&mut stream).await {
            Ok(callback) => callback,
            Err(error) => {
                write_browser_response(&mut stream, BrowserCallbackResponse::Failure).await;
                return AuthorizationCompletion::Failed(error);
            }
        };
        if expected_state
            .as_bytes()
            .ct_eq(callback.state.as_bytes())
            .unwrap_u8()
            != 1
        {
            write_browser_response(&mut stream, BrowserCallbackResponse::Failure).await;
            return AuthorizationCompletion::Failed(AccountAuthError::new(
                "state_mismatch",
                "账户回调验证失败。",
                "OAuth state did not match the pending authorization request.",
                false,
            ));
        }
        if let Some(error) = callback.error {
            if error == "access_denied" {
                write_browser_response(&mut stream, BrowserCallbackResponse::Cancelled).await;
                return AuthorizationCompletion::Cancelled;
            }
            write_browser_response(&mut stream, BrowserCallbackResponse::Failure).await;
            return AuthorizationCompletion::Failed(AccountAuthError::new(
                "authorization_failed",
                "Aurona Account 授权未能完成。",
                format!(
                    "{}: {}",
                    error,
                    callback.error_description.as_deref().unwrap_or(""),
                ),
                true,
            ));
        }
        let Some(code) = callback.code else {
            return AuthorizationCompletion::Failed(protocol_message(
                "Loopback callback has no authorization code",
            ));
        };
        write_browser_response(&mut stream, BrowserCallbackResponse::Success).await;
        if !self
            .set_authorization_phase(authorization_id, AccountAuthPhase::ExchangingCode)
            .await
        {
            return AuthorizationCompletion::Cancelled;
        }
        let tokens = match self
            .exchange_code(&discovery, &redirect_uri, &verifier, &code)
            .await
        {
            Ok(tokens) => tokens,
            Err(error) => return AuthorizationCompletion::Failed(error),
        };
        if let Err(error) = validate_token_type(&tokens) {
            return AuthorizationCompletion::Failed(error);
        }
        match self
            .accept_initial_tokens(authorization_id, &discovery, tokens, &nonce)
            .await
        {
            Ok(true) => AuthorizationCompletion::Completed,
            Ok(false) => AuthorizationCompletion::Cancelled,
            Err(error) => AuthorizationCompletion::Failed(error),
        }
    }

    async fn exchange_code(
        &self,
        discovery: &DiscoveryDocument,
        redirect_uri: &str,
        verifier: &str,
        code: &str,
    ) -> Result<TokenResponse, AccountAuthError> {
        let response = self
            .http
            .post(&discovery.token_endpoint)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", redirect_uri),
                ("client_id", self.client_id()?),
                ("code_verifier", verifier),
            ])
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            return Err(AccountAuthError::new(
                "token_exchange_failed",
                "Aurona Account 未能完成登录。",
                format!("token endpoint returned {status}: {detail}"),
                true,
            ));
        }
        response.json().await.map_err(protocol_error)
    }

    async fn accept_initial_tokens(
        &self,
        authorization_id: u64,
        discovery: &DiscoveryDocument,
        tokens: TokenResponse,
        expected_nonce: &str,
    ) -> Result<bool, AccountAuthError> {
        let id_token = tokens
            .id_token
            .as_deref()
            .ok_or_else(|| protocol_message("OIDC token response did not include an ID token"))?;
        let claims = self
            .validate_id_token(discovery, id_token, Some(expected_nonce))
            .await?;
        let profile = self.fetch_userinfo(discovery, &tokens.access_token).await?;
        validate_subject_match(&claims.sub, &profile.subject)?;
        self.commit_initial_authorization(authorization_id, tokens, profile)
            .await
    }

    async fn accept_refreshed_tokens(
        &self,
        discovery: &DiscoveryDocument,
        tokens: TokenResponse,
    ) -> Result<(), AccountAuthError> {
        let existing_profile = self.runtime.lock().await.status.profile.clone();
        if let Some(id_token) = tokens.id_token.as_deref() {
            let claims = self.validate_id_token(discovery, id_token, None).await?;
            if existing_profile
                .as_ref()
                .is_some_and(|profile| profile.subject != claims.sub)
            {
                return Err(protocol_message(
                    "Refreshed ID token changed the account subject",
                ));
            }
        }
        if let Some(refresh_token) = tokens.refresh_token.as_deref() {
            write_refresh_token(refresh_token).map_err(credential_error)?;
        }
        let profile = if let Some(profile) = existing_profile {
            profile
        } else {
            self.fetch_userinfo(discovery, &tokens.access_token).await?
        };
        self.set_authenticated(tokens, profile).await;
        Ok(())
    }

    async fn validate_id_token(
        &self,
        discovery: &DiscoveryDocument,
        token: &str,
        expected_nonce: Option<&str>,
    ) -> Result<IdTokenClaims, AccountAuthError> {
        let header = decode_header(token).map_err(protocol_error)?;
        if !matches!(
            header.alg,
            Algorithm::RS256 | Algorithm::PS256 | Algorithm::ES256 | Algorithm::EdDSA
        ) {
            return Err(protocol_message(
                "ID token uses a disallowed signing algorithm",
            ));
        }
        let kid = header
            .kid
            .as_deref()
            .ok_or_else(|| protocol_message("ID token header is missing kid"))?;
        let jwks: JwkSet = self
            .http
            .get(&discovery.jwks_uri)
            .send()
            .await
            .map_err(network_error)?
            .error_for_status()
            .map_err(network_error)?
            .json()
            .await
            .map_err(protocol_error)?;
        let jwk = jwks
            .find(kid)
            .ok_or_else(|| protocol_message("No matching signing key exists in the JWKS"))?;
        let key = DecodingKey::from_jwk(jwk).map_err(protocol_error)?;
        let mut validation = Validation::new(header.alg);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.set_issuer(&[discovery.issuer.as_str()]);
        validation.set_audience(&[self.client_id()?]);
        validation.leeway = 60;
        let claims = decode::<IdTokenClaims>(token, &key, &validation)
            .map_err(protocol_error)?
            .claims;
        if claims.iss != discovery.issuer {
            return Err(protocol_message("ID token issuer mismatch"));
        }
        let audiences = claims.aud.values();
        if audiences.len() > 1 && claims.azp.as_deref() != Some(self.client_id()?) {
            return Err(protocol_message(
                "ID token azp is required for multiple audiences",
            ));
        }
        if let Some(expected_nonce) = expected_nonce {
            let actual = claims
                .nonce
                .as_deref()
                .ok_or_else(|| protocol_message("ID token is missing nonce"))?;
            if expected_nonce
                .as_bytes()
                .ct_eq(actual.as_bytes())
                .unwrap_u8()
                != 1
            {
                return Err(protocol_message("ID token nonce mismatch"));
            }
        }
        let now = unix_now();
        if claims.iat > now.saturating_add(60) || claims.exp <= claims.iat {
            return Err(protocol_message("ID token timestamps are invalid"));
        }
        Ok(claims)
    }

    async fn fetch_userinfo(
        &self,
        discovery: &DiscoveryDocument,
        access_token: &str,
    ) -> Result<AccountProfile, AccountAuthError> {
        let endpoint = discovery
            .userinfo_endpoint
            .as_deref()
            .ok_or_else(|| protocol_message("UserInfo endpoint is unavailable"))?;
        let response = self
            .http
            .get(endpoint)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(AccountAuthError::new(
                "userinfo_failed",
                "无法读取 Aurona Account 资料。",
                format!("userinfo returned HTTP {}", response.status()),
                true,
            ));
        }
        let user: UserInfoResponse = response.json().await.map_err(protocol_error)?;
        Ok(AccountProfile {
            subject: user.sub,
            name: user.name,
            preferred_username: user.preferred_username,
            email: user.email,
            email_verified: user.email_verified,
            picture: user.picture.and_then(sanitize_picture_url),
        })
    }

    async fn set_authenticated(&self, tokens: TokenResponse, profile: AccountProfile) {
        let expires_at = tokens
            .expires_in
            .map(|seconds| unix_now().saturating_add(seconds));
        let mut runtime = self.runtime.lock().await;
        runtime.access_token = Some(tokens.access_token);
        runtime.cancel = None;
        runtime.status.phase = AccountAuthPhase::SignedIn;
        runtime.status.profile = Some(profile);
        runtime.status.expires_at_unix = expires_at;
        runtime.status.last_error = None;
        runtime.status.last_notice = None;
    }

    async fn commit_initial_authorization(
        &self,
        authorization_id: u64,
        tokens: TokenResponse,
        profile: AccountProfile,
    ) -> Result<bool, AccountAuthError> {
        let expires_at = tokens
            .expires_in
            .map(|seconds| unix_now().saturating_add(seconds));
        let mut runtime = self.runtime.lock().await;
        if runtime.active_authorization != Some(authorization_id) {
            return Ok(false);
        }
        if let Some(refresh_token) = tokens.refresh_token.as_deref() {
            write_refresh_token(refresh_token).map_err(credential_error)?;
        }
        runtime.access_token = Some(tokens.access_token);
        runtime.cancel = None;
        runtime.active_authorization = None;
        runtime.status.phase = AccountAuthPhase::SignedIn;
        runtime.status.profile = Some(profile);
        runtime.status.expires_at_unix = expires_at;
        runtime.status.last_error = None;
        runtime.status.last_notice = None;
        Ok(true)
    }

    async fn set_phase(&self, phase: AccountAuthPhase) {
        self.runtime.lock().await.status.phase = phase;
    }

    async fn begin_authorization(&self) -> (u64, oneshot::Receiver<()>) {
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let mut runtime = self.runtime.lock().await;
        runtime.next_authorization = runtime.next_authorization.wrapping_add(1);
        if runtime.next_authorization == 0 {
            runtime.next_authorization = 1;
        }
        let authorization_id = runtime.next_authorization;
        runtime.active_authorization = Some(authorization_id);
        runtime.cancel = Some(cancel_tx);
        runtime.status.phase = AccountAuthPhase::Discovering;
        runtime.status.last_error = None;
        runtime.status.last_notice = None;
        (authorization_id, cancel_rx)
    }

    async fn is_active_authorization(&self, authorization_id: u64) -> bool {
        self.runtime.lock().await.active_authorization == Some(authorization_id)
    }

    async fn set_authorization_phase(
        &self,
        authorization_id: u64,
        phase: AccountAuthPhase,
    ) -> bool {
        let mut runtime = self.runtime.lock().await;
        if runtime.active_authorization != Some(authorization_id) {
            return false;
        }
        runtime.status.phase = phase;
        true
    }

    async fn finish_authorization_cancelled(&self, authorization_id: u64) {
        let mut runtime = self.runtime.lock().await;
        if runtime.active_authorization != Some(authorization_id) {
            return;
        }
        runtime.cancel = None;
        runtime.active_authorization = None;
        runtime.status.phase = AccountAuthPhase::SignedOut;
        runtime.status.last_error = None;
        runtime.status.last_notice = Some("已取消授权。".into());
    }

    async fn finish_authorization_failure(&self, authorization_id: u64, error: AccountAuthError) {
        let mut runtime = self.runtime.lock().await;
        if runtime.active_authorization != Some(authorization_id) {
            return;
        }
        runtime.cancel = None;
        runtime.active_authorization = None;
        runtime.status.phase = AccountAuthPhase::Failed;
        runtime.status.last_error = Some(error);
        runtime.status.last_notice = None;
    }

    async fn fail(&self, error: AccountAuthError) {
        let mut runtime = self.runtime.lock().await;
        if !runtime.status.enabled {
            runtime.status.phase = AccountAuthPhase::Disabled;
            return;
        }
        runtime.cancel = None;
        runtime.active_authorization = None;
        runtime.status.phase = AccountAuthPhase::Failed;
        runtime.status.last_error = Some(error);
        runtime.status.last_notice = None;
    }

    async fn clear_session(&self) {
        let mut runtime = self.runtime.lock().await;
        runtime.access_token = None;
        runtime.status.profile = None;
        runtime.status.expires_at_unix = None;
        runtime.status.last_error = None;
        runtime.status.last_notice = None;
        runtime.active_authorization = None;
        runtime.status.phase = if runtime.status.enabled {
            AccountAuthPhase::SignedOut
        } else {
            AccountAuthPhase::Disabled
        };
    }
}

pub struct AccountAuthState(pub Arc<AccountAuthService>);

impl Default for AccountAuthState {
    fn default() -> Self {
        Self(Arc::new(AccountAuthService::default()))
    }
}

#[tauri::command]
pub async fn account_auth_status(
    state: tauri::State<'_, AccountAuthState>,
) -> Result<AccountAuthStatus, AccountAuthError> {
    Ok(state.0.status().await)
}

#[tauri::command]
pub async fn account_auth_start(
    app: AppHandle,
    state: tauri::State<'_, AccountAuthState>,
) -> Result<(), AccountAuthError> {
    state.0.start(&app).await
}

#[tauri::command]
pub async fn account_auth_cancel(
    state: tauri::State<'_, AccountAuthState>,
) -> Result<(), AccountAuthError> {
    state.0.cancel().await;
    Ok(())
}

#[tauri::command]
pub async fn account_auth_refresh(
    state: tauri::State<'_, AccountAuthState>,
) -> Result<AccountAuthStatus, AccountAuthError> {
    let result = state.0.refresh().await;
    if let Err(error) = &result {
        state.0.fail(error.clone()).await;
    }
    result
}

#[tauri::command]
pub async fn account_auth_restore(
    state: tauri::State<'_, AccountAuthState>,
) -> Result<AccountAuthStatus, AccountAuthError> {
    let result = state.0.restore().await;
    if let Err(error) = &result {
        state.0.fail(error.clone()).await;
    }
    result
}

#[tauri::command]
pub async fn account_auth_logout(
    state: tauri::State<'_, AccountAuthState>,
) -> Result<(), AccountAuthError> {
    state.0.logout().await
}

#[tauri::command]
pub async fn account_auth_shutdown(
    state: tauri::State<'_, AccountAuthState>,
) -> Result<(), AccountAuthError> {
    state.0.shutdown().await;
    Ok(())
}

fn random_secret(length: usize) -> String {
    rand::rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

fn normalized_origin(value: &str) -> Result<String, AccountAuthError> {
    let url = Url::parse(value).map_err(url_error)?;
    if url.username() != "" || url.password().is_some() || url.fragment().is_some() {
        return Err(protocol_message(
            "Provider URL contains forbidden userinfo or fragment",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| protocol_message("Provider URL has no host"))?;
    let mut origin = format!("{}://{host}", url.scheme());
    if let Some(port) = url.port() {
        origin.push_str(&format!(":{port}"));
    }
    Ok(origin)
}

fn validate_provider_endpoint(
    endpoint: &str,
    expected_origin: &str,
    allow_insecure_loopback: bool,
) -> Result<(), AccountAuthError> {
    let url = Url::parse(endpoint).map_err(url_error)?;
    let origin = normalized_origin(endpoint)?;
    if origin != expected_origin {
        return Err(protocol_message(
            "OIDC endpoint origin differs from issuer origin",
        ));
    }
    let secure = url.scheme() == "https";
    let allowed_mock =
        allow_insecure_loopback && url.scheme() == "http" && url.host_str() == Some("127.0.0.1");
    if !secure && !allowed_mock {
        return Err(protocol_message("OIDC endpoints must use HTTPS"));
    }
    Ok(())
}

async fn read_callback(
    stream: &mut tokio::net::TcpStream,
) -> Result<CallbackPayload, AccountAuthError> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    loop {
        let count = stream.read(&mut chunk).await.map_err(|error| {
            AccountAuthError::new(
                "callback_read_failed",
                "无法读取账户回调。",
                error.to_string(),
                true,
            )
        })?;
        if count == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..count]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if request.len() > MAX_CALLBACK_REQUEST_BYTES {
            return Err(protocol_message("Loopback callback request is too large"));
        }
    }
    let request = std::str::from_utf8(&request).map_err(protocol_error)?;
    let first_line = request
        .lines()
        .next()
        .ok_or_else(|| protocol_message("Loopback callback has no request line"))?;
    let mut parts = first_line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err(protocol_message("Loopback callback must use GET"));
    }
    let target = parts
        .next()
        .ok_or_else(|| protocol_message("Loopback callback target is missing"))?;
    let url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(url_error)?;
    if url.path() != CALLBACK_PATH {
        return Err(AccountAuthError::new(
            "callback_path_mismatch",
            "账户回调地址不匹配。",
            format!("Expected {CALLBACK_PATH}, received {}", url.path()),
            false,
        ));
    }
    let values: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let code = values
        .get("code")
        .filter(|value| !value.is_empty())
        .cloned();
    let error = values
        .get("error")
        .filter(|value| !value.is_empty())
        .cloned();
    if code.is_some() == error.is_some() {
        return Err(protocol_message(
            "Loopback callback must contain exactly one of code or error",
        ));
    }
    let state = values
        .get("state")
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| protocol_message("Loopback callback has no state"))?;
    Ok(CallbackPayload {
        state,
        code,
        error,
        error_description: values.get("error_description").cloned(),
    })
}

async fn write_browser_response(
    stream: &mut tokio::net::TcpStream,
    response: BrowserCallbackResponse,
) {
    let (status, title, message) = match response {
        BrowserCallbackResponse::Success => (
            "200 OK",
            "Aurona Code",
            "已收到授权结果，可以关闭此页面并返回 Aurona Code。",
        ),
        BrowserCallbackResponse::Cancelled => (
            "200 OK",
            "Aurona Code",
            "已取消授权，可以关闭此页面并返回 Aurona Code。",
        ),
        BrowserCallbackResponse::Failure => (
            "400 Bad Request",
            "Aurona Code",
            "无法验证授权回调，请关闭此页面后重试。",
        ),
    };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title><style>body{{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;color:#202124}}main{{max-width:32rem;padding:2rem}}h1{{font-size:1.35rem}}</style><main><h1>{title}</h1><p>{message}</p></main>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn read_refresh_token() -> Result<String, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH_TOKEN)
        .and_then(|entry| entry.get_password())
        .map_err(|error| error.to_string())
}

fn write_refresh_token(value: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH_TOKEN)
        .and_then(|entry| entry.set_password(value))
        .map_err(|error| error.to_string())
}

fn delete_refresh_token() -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH_TOKEN)
        .and_then(|entry| entry.delete_credential())
        .map_err(|error| error.to_string())
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn network_error(error: reqwest::Error) -> AccountAuthError {
    AccountAuthError::new(
        "account_network_error",
        "无法连接 Aurona Account。",
        error.to_string(),
        true,
    )
}

fn protocol_error(error: impl std::fmt::Display) -> AccountAuthError {
    protocol_message(error.to_string())
}

fn protocol_message(message: impl Into<String>) -> AccountAuthError {
    AccountAuthError::new(
        "oidc_protocol_error",
        "Aurona Account 返回了无法验证的授权数据。",
        message,
        false,
    )
}

fn url_error(error: url::ParseError) -> AccountAuthError {
    protocol_message(format!("Invalid OIDC URL: {error}"))
}

fn credential_error(error: String) -> AccountAuthError {
    AccountAuthError::new(
        "credential_store_error",
        "无法安全保存账户授权。",
        error,
        true,
    )
}

fn validate_token_type(tokens: &TokenResponse) -> Result<(), AccountAuthError> {
    if !tokens.token_type.eq_ignore_ascii_case("bearer") {
        return Err(protocol_message("OAuth token_type is not Bearer"));
    }
    Ok(())
}

fn validate_subject_match(
    id_token_subject: &str,
    userinfo_subject: &str,
) -> Result<(), AccountAuthError> {
    if id_token_subject != userinfo_subject {
        return Err(protocol_message(
            "UserInfo subject does not match ID token subject",
        ));
    }
    Ok(())
}

fn sanitize_picture_url(value: String) -> Option<String> {
    let url = Url::parse(&value).ok()?;
    let host = url.host_str()?;
    let aurona_host = host == "aurona.cc" || host.ends_with(".aurona.cc");
    (url.scheme() == "https"
        && aurona_host
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none())
    .then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use rand08::rngs::OsRng;
    use rsa::{
        pkcs8::{EncodePrivateKey, LineEnding},
        traits::PublicKeyParts,
        RsaPrivateKey, RsaPublicKey,
    };
    use serde::Serialize;
    use tokio::task::JoinHandle;

    const REGISTERED_TEST_CLIENT_ID: &str = "aurona_Eqg8DBjkJxk2rbXHY6vloqzplfgbO024";

    #[test]
    fn client_id_is_normalized_from_the_build_environment() {
        assert_eq!(super::config::sanitize_client_id(None), None);
        assert_eq!(super::config::sanitize_client_id(Some("")), None);
        assert_eq!(super::config::sanitize_client_id(Some("   ")), None);
        assert_eq!(
            super::config::sanitize_client_id(Some("  aurona_local_test  ")),
            Some("aurona_local_test".to_owned())
        );
        // The build-time reader must stay consistent with the pure normalizer.
        assert_eq!(
            super::config::client_id_from_build_env(),
            super::config::sanitize_client_id(option_env!("AURONA_ACCOUNT_CLIENT_ID"))
        );
    }

    #[derive(Serialize)]
    struct MockClaims<'a> {
        iss: &'a str,
        sub: &'a str,
        aud: &'a str,
        exp: u64,
        iat: u64,
        nonce: &'a str,
    }

    async fn read_mock_request(stream: &mut tokio::net::TcpStream) -> (String, String) {
        let mut request = Vec::new();
        let mut buffer = [0_u8; 2048];
        let header_end;
        loop {
            let count = stream.read(&mut buffer).await.unwrap();
            assert!(count > 0);
            request.extend_from_slice(&buffer[..count]);
            if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                header_end = position + 4;
                break;
            }
        }
        let headers = String::from_utf8_lossy(&request[..header_end]).into_owned();
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        while request.len() < header_end + content_length {
            let count = stream.read(&mut buffer).await.unwrap();
            request.extend_from_slice(&buffer[..count]);
        }
        let target = headers
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .to_owned();
        let body =
            String::from_utf8(request[header_end..header_end + content_length].to_vec()).unwrap();
        (target, body)
    }

    async fn write_mock_response(
        stream: &mut tokio::net::TcpStream,
        status: &str,
        content_type: &str,
        extra_headers: &str,
        body: &str,
    ) {
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
    }

    async fn start_mock_provider() -> (String, JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server_base = base.clone();
        let private_key = RsaPrivateKey::new(&mut OsRng, 2048).unwrap();
        let public_key = RsaPublicKey::from(&private_key);
        let private_pem = private_key.to_pkcs8_pem(LineEnding::LF).unwrap();
        let signing_key = EncodingKey::from_rsa_pem(private_pem.as_bytes()).unwrap();
        let jwks = serde_json::json!({
            "keys": [{
                "kty": "RSA",
                "kid": "mock-key",
                "use": "sig",
                "alg": "RS256",
                "n": URL_SAFE_NO_PAD.encode(public_key.n().to_bytes_be()),
                "e": URL_SAFE_NO_PAD.encode(public_key.e().to_bytes_be())
            }]
        })
        .to_string();
        let handle = tokio::spawn(async move {
            let mut expected_challenge = None::<String>;
            let mut expected_nonce = None::<String>;
            let mut code_consumed = false;
            for _ in 0..8 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let (target, body) = read_mock_request(&mut stream).await;
                let url = Url::parse(&format!("{server_base}{target}")).unwrap();
                match url.path() {
                    "/.well-known/openid-configuration" => {
                        let document = serde_json::json!({
                            "issuer": server_base,
                            "authorization_endpoint": format!("{server_base}/authorize"),
                            "token_endpoint": format!("{server_base}/token"),
                            "jwks_uri": format!("{server_base}/jwks"),
                            "userinfo_endpoint": format!("{server_base}/userinfo"),
                            "revocation_endpoint": format!("{server_base}/revoke"),
                            "code_challenge_methods_supported": ["S256"],
                            "scopes_supported": ["openid", "profile", "email"],
                            "response_types_supported": ["code"],
                            "grant_types_supported": ["authorization_code", "refresh_token"],
                            "token_endpoint_auth_methods_supported": ["none"]
                        })
                        .to_string();
                        write_mock_response(
                            &mut stream,
                            "200 OK",
                            "application/json",
                            "",
                            &document,
                        )
                        .await;
                    }
                    "/authorize" => {
                        let query: HashMap<String, String> =
                            url.query_pairs().into_owned().collect();
                        assert_eq!(query.get("response_type").map(String::as_str), Some("code"));
                        assert_eq!(
                            query.get("code_challenge_method").map(String::as_str),
                            Some("S256")
                        );
                        expected_challenge = query.get("code_challenge").cloned();
                        expected_nonce = query.get("nonce").cloned();
                        let mut redirect = Url::parse(query.get("redirect_uri").unwrap()).unwrap();
                        redirect
                            .query_pairs_mut()
                            .append_pair("code", "mock-one-time-code")
                            .append_pair("state", query.get("state").unwrap());
                        write_mock_response(
                            &mut stream,
                            "302 Found",
                            "text/plain",
                            &format!("Location: {redirect}\r\n"),
                            "",
                        )
                        .await;
                    }
                    "/token" => {
                        let form: HashMap<String, String> =
                            url::form_urlencoded::parse(body.as_bytes())
                                .into_owned()
                                .collect();
                        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(
                            form.get("code_verifier")
                                .map_or("", String::as_str)
                                .as_bytes(),
                        ));
                        if code_consumed
                            || form.get("code").map(String::as_str) != Some("mock-one-time-code")
                            || expected_challenge.as_deref() != Some(challenge.as_str())
                        {
                            write_mock_response(
                                &mut stream,
                                "400 Bad Request",
                                "application/json",
                                "",
                                r#"{"error":"invalid_grant"}"#,
                            )
                            .await;
                            continue;
                        }
                        code_consumed = true;
                        let now = unix_now();
                        let mut header = Header::new(Algorithm::RS256);
                        header.kid = Some("mock-key".into());
                        let id_token = encode(
                            &header,
                            &MockClaims {
                                iss: &server_base,
                                sub: "aurona-user-1",
                                aud: "aurona-code-local-test",
                                exp: now + 300,
                                iat: now,
                                nonce: expected_nonce.as_deref().unwrap(),
                            },
                            &signing_key,
                        )
                        .unwrap();
                        let response = serde_json::json!({
                            "access_token": "mock-access-token",
                            "token_type": "Bearer",
                            "expires_in": 300,
                            "refresh_token": "mock-refresh-token",
                            "id_token": id_token
                        })
                        .to_string();
                        write_mock_response(
                            &mut stream,
                            "200 OK",
                            "application/json",
                            "",
                            &response,
                        )
                        .await;
                    }
                    "/jwks" => {
                        write_mock_response(&mut stream, "200 OK", "application/json", "", &jwks)
                            .await;
                    }
                    "/userinfo" => {
                        let response = serde_json::json!({
                            "sub": "aurona-user-1",
                            "name": "Local Mock User",
                            "preferred_username": "mock-user",
                            "email": "mock@localhost",
                            "email_verified": true,
                            "picture": "https://account.aurona.cc/avatar/mock-user.png"
                        })
                        .to_string();
                        write_mock_response(
                            &mut stream,
                            "200 OK",
                            "application/json",
                            "",
                            &response,
                        )
                        .await;
                    }
                    path => panic!("unexpected mock provider path: {path}"),
                }
            }
        });
        (base, handle)
    }

    #[test]
    fn production_feature_is_hidden_without_a_client_id() {
        let config = AccountProviderConfig {
            client_id: None,
            ..AccountProviderConfig::default()
        };
        assert!(config.client_id.is_none());
        let service = AccountAuthService::new(config);
        assert!(service.ensure_enabled().is_err());
    }

    #[test]
    fn pkce_challenge_is_s256_base64url_without_padding() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert!(!challenge.contains('='));
    }

    #[test]
    fn provider_rejects_insecure_and_cross_origin_endpoints() {
        assert!(validate_provider_endpoint(
            "http://auth.aurona.cc/token",
            "https://auth.aurona.cc",
            false
        )
        .is_err());
        assert!(validate_provider_endpoint(
            "https://evil.example/token",
            "https://auth.aurona.cc",
            false
        )
        .is_err());
        assert!(validate_provider_endpoint(
            "http://127.0.0.1:4400/token",
            "http://127.0.0.1:4400",
            true
        )
        .is_ok());
    }

    #[tokio::test]
    async fn loopback_callback_accepts_code_and_state() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = tokio::spawn(async move {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream
                .write_all(b"GET /oauth/callback?code=one-time-code&state=expected HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
                .await
                .unwrap();
        });
        let (mut stream, _) = listener.accept().await.unwrap();
        let callback = read_callback(&mut stream).await.unwrap();
        client.await.unwrap();
        assert_eq!(callback.code.as_deref(), Some("one-time-code"));
        assert_eq!(callback.state, "expected");
        assert!(callback.error.is_none());
    }

    #[tokio::test]
    async fn loopback_callback_rejects_wrong_path() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream
                .write_all(b"GET /wrong?code=x&state=y HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
                .await
                .unwrap();
        });
        let (mut stream, _) = listener.accept().await.unwrap();
        assert!(read_callback(&mut stream).await.is_err());
    }

    #[tokio::test]
    async fn authorization_error_preserves_state_for_csrf_validation() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream
                .write_all(b"GET /oauth/callback?error=access_denied&error_description=cancelled&state=expected HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
                .await
                .unwrap();
        });
        let (mut stream, _) = listener.accept().await.unwrap();
        let callback = read_callback(&mut stream).await.unwrap();
        assert_eq!(callback.state, "expected");
        assert_eq!(callback.error.as_deref(), Some("access_denied"));
    }

    #[tokio::test]
    async fn access_denied_is_a_normal_cancelled_authorization() {
        let service = AccountAuthService::new(AccountProviderConfig {
            enabled: true,
            client_id: Some("test-client".into()),
            ..AccountProviderConfig::default()
        });
        let (authorization_id, cancel_rx) = service.begin_authorization().await;
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream
                .write_all(b"GET /oauth/callback?error=access_denied&state=fresh-state HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
                .await
                .unwrap();
        });
        let discovery = DiscoveryDocument {
            issuer: "https://auth.aurona.cc".into(),
            authorization_endpoint: "https://auth.aurona.cc/api/auth/oauth2/authorize".into(),
            token_endpoint: "https://auth.aurona.cc/api/auth/oauth2/token".into(),
            jwks_uri: "https://auth.aurona.cc/api/auth/jwks".into(),
            userinfo_endpoint: Some("https://auth.aurona.cc/api/auth/oauth2/userinfo".into()),
            revocation_endpoint: Some("https://auth.aurona.cc/api/auth/oauth2/revoke".into()),
            code_challenge_methods_supported: Some(vec!["S256".into()]),
            scopes_supported: None,
            response_types_supported: Some(vec!["code".into()]),
            grant_types_supported: Some(vec!["authorization_code".into()]),
            token_endpoint_auth_methods_supported: Some(vec!["none".into()]),
        };
        let result = service
            .complete_authorization(
                authorization_id,
                listener,
                cancel_rx,
                discovery,
                "http://127.0.0.1:49152/oauth/callback".into(),
                "fresh-verifier".into(),
                "fresh-state".into(),
                "fresh-nonce".into(),
            )
            .await;
        assert!(matches!(result, AuthorizationCompletion::Cancelled));
        service
            .finish_authorization_cancelled(authorization_id)
            .await;
        let status = service.status().await;
        assert_eq!(status.phase, AccountAuthPhase::SignedOut);
        assert_eq!(status.last_notice.as_deref(), Some("已取消授权。"));
        assert!(status.last_error.is_none());
    }

    #[tokio::test]
    async fn pending_authorization_can_be_cancelled_without_leaving_stale_state() {
        let service = AccountAuthService::new(AccountProviderConfig {
            enabled: true,
            client_id: Some("test-client".into()),
            ..AccountProviderConfig::default()
        });
        let (_, cancel_rx) = service.begin_authorization().await;
        service.cancel().await;
        assert!(cancel_rx.await.is_ok());
        assert_eq!(service.status().await.phase, AccountAuthPhase::SignedOut);
        assert_eq!(
            service.status().await.last_notice.as_deref(),
            Some("已取消授权。")
        );
    }

    #[tokio::test]
    async fn cancelled_transaction_cannot_overwrite_a_new_authorization() {
        let service = AccountAuthService::new(AccountProviderConfig {
            enabled: true,
            client_id: Some("test-client".into()),
            ..AccountProviderConfig::default()
        });
        let (first, _) = service.begin_authorization().await;
        service.finish_authorization_cancelled(first).await;
        let (second, _) = service.begin_authorization().await;
        assert_ne!(first, second);

        service
            .finish_authorization_failure(
                first,
                AccountAuthError::new("old_callback", "旧授权失败", "stale transaction", true),
            )
            .await;

        let runtime = service.runtime.lock().await;
        assert_eq!(runtime.active_authorization, Some(second));
        assert_eq!(runtime.status.phase, AccountAuthPhase::Discovering);
        assert!(runtime.status.last_error.is_none());
    }

    #[test]
    fn authorization_url_contains_the_complete_public_client_request() {
        let service = AccountAuthService::new(AccountProviderConfig {
            enabled: true,
            client_id: Some(REGISTERED_TEST_CLIENT_ID.into()),
            ..AccountProviderConfig::default()
        });
        let discovery = DiscoveryDocument {
            issuer: "https://auth.aurona.cc".into(),
            authorization_endpoint: "https://auth.aurona.cc/api/auth/oauth2/authorize".into(),
            token_endpoint: "https://auth.aurona.cc/api/auth/oauth2/token".into(),
            jwks_uri: "https://auth.aurona.cc/api/auth/jwks".into(),
            userinfo_endpoint: Some("https://auth.aurona.cc/api/auth/oauth2/userinfo".into()),
            revocation_endpoint: Some("https://auth.aurona.cc/api/auth/oauth2/revoke".into()),
            code_challenge_methods_supported: Some(vec!["S256".into()]),
            scopes_supported: None,
            response_types_supported: Some(vec!["code".into()]),
            grant_types_supported: Some(vec!["authorization_code".into()]),
            token_endpoint_auth_methods_supported: Some(vec!["none".into()]),
        };
        let url = service
            .authorization_url(
                &discovery,
                "http://127.0.0.1:49152/oauth/callback",
                "fresh-state",
                "fresh-nonce",
                "fresh-challenge",
            )
            .unwrap();
        let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
        assert_eq!(
            query.get("client_id").map(String::as_str),
            Some(REGISTERED_TEST_CLIENT_ID)
        );
        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:49152/oauth/callback")
        );
        assert_eq!(query.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(query.get("state").map(String::as_str), Some("fresh-state"));
        assert_eq!(query.get("nonce").map(String::as_str), Some("fresh-nonce"));
        assert_eq!(
            query.get("code_challenge").map(String::as_str),
            Some("fresh-challenge")
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
    }

    #[test]
    fn mismatched_userinfo_subject_is_rejected() {
        assert!(validate_subject_match("id-token-user", "different-user").is_err());
    }

    #[test]
    fn profile_picture_is_limited_to_https_aurona_hosts() {
        assert_eq!(
            sanitize_picture_url("https://account.aurona.cc/avatar/me.png".into()).as_deref(),
            Some("https://account.aurona.cc/avatar/me.png")
        );
        assert!(sanitize_picture_url("http://account.aurona.cc/avatar/me.png".into()).is_none());
        assert!(sanitize_picture_url("https://evil.example/avatar/me.png".into()).is_none());
    }

    #[tokio::test]
    async fn local_mock_provider_verifies_redirect_pkce_nonce_tokens_and_userinfo() {
        let (base, provider) = start_mock_provider().await;
        let service = AccountAuthService::new(AccountProviderConfig {
            enabled: true,
            client_id: Some("aurona-code-local-test".into()),
            discovery_url: format!("{base}/.well-known/openid-configuration"),
            expected_issuer: base.clone(),
            scopes: vec!["openid".into(), "profile".into(), "email".into()],
            allow_insecure_loopback_provider: true,
        });
        let discovery = service.discover().await.unwrap();
        let verifier = random_secret(64);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let authorization_url = service
            .authorization_url(
                &discovery,
                "http://127.0.0.1:49152/oauth/callback",
                "expected-state",
                "expected-nonce",
                &challenge,
            )
            .unwrap();
        let response = service.http.get(authorization_url).send().await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::FOUND);
        let location = Url::parse(
            response
                .headers()
                .get("location")
                .unwrap()
                .to_str()
                .unwrap(),
        )
        .unwrap();
        let callback: HashMap<String, String> = location.query_pairs().into_owned().collect();
        assert_eq!(
            callback.get("state").map(String::as_str),
            Some("expected-state")
        );
        let tokens = service
            .exchange_code(
                &discovery,
                "http://127.0.0.1:49152/oauth/callback",
                &verifier,
                callback.get("code").unwrap(),
            )
            .await
            .unwrap();
        assert!(service
            .exchange_code(
                &discovery,
                "http://127.0.0.1:49152/oauth/callback",
                &verifier,
                callback.get("code").unwrap(),
            )
            .await
            .is_err());
        let id_token = tokens.id_token.as_deref().unwrap();
        assert!(service
            .validate_id_token(&discovery, id_token, Some("wrong-nonce"))
            .await
            .is_err());
        let mut tampered_id_token = id_token.to_owned();
        let replacement = if tampered_id_token.ends_with('A') {
            'B'
        } else {
            'A'
        };
        tampered_id_token.pop();
        tampered_id_token.push(replacement);
        assert!(service
            .validate_id_token(&discovery, &tampered_id_token, Some("expected-nonce"))
            .await
            .is_err());
        let claims = service
            .validate_id_token(&discovery, id_token, Some("expected-nonce"))
            .await
            .unwrap();
        let profile = service
            .fetch_userinfo(&discovery, &tokens.access_token)
            .await
            .unwrap();
        assert_eq!(claims.sub, profile.subject);
        assert_eq!(profile.preferred_username.as_deref(), Some("mock-user"));
        assert_eq!(profile.email_verified, Some(true));
        assert_eq!(
            profile.picture.as_deref(),
            Some("https://account.aurona.cc/avatar/mock-user.png")
        );
        provider.await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires the local Aurona Account/Auth development services"]
    async fn local_aurona_account_discovery_contract_is_compatible() {
        let issuer = std::env::var("AURONA_ACCOUNT_TEST_ISSUER")
            .unwrap_or_else(|_| "http://127.0.0.1:5174".into());
        let service = AccountAuthService::new(AccountProviderConfig {
            enabled: true,
            client_id: Some("aurona_code_local_dev".into()),
            discovery_url: format!("{issuer}/.well-known/openid-configuration"),
            expected_issuer: issuer.clone(),
            scopes: vec![
                "openid".into(),
                "profile".into(),
                "email".into(),
                "offline_access".into(),
            ],
            allow_insecure_loopback_provider: true,
        });
        let discovery = service.discover().await.unwrap();
        assert_eq!(discovery.issuer, issuer);
        assert!(discovery
            .authorization_endpoint
            .ends_with("/oauth2/authorize"));
        assert!(discovery.token_endpoint.ends_with("/oauth2/token"));
        assert!(discovery.userinfo_endpoint.is_some());
        assert!(discovery.revocation_endpoint.is_some());
    }
}
