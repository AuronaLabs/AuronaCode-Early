//! 网络代理偏好（仅作用于 Rust 侧网络：更新检查由前端 check 选项直传；
//! 工具链下载与 Marketplace 扩展包下载走本模块，统一跟随代理三档设置）。

use std::sync::{OnceLock, RwLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ProxyMode {
    /// 跟随系统（reqwest 默认行为：读取环境变量 / 系统代理）
    #[default]
    System,
    /// 自定义代理地址
    Custom,
    /// 强制直连
    None,
}

#[derive(Debug, Clone, Default)]
pub struct ProxyConfig {
    pub mode: ProxyMode,
    pub url: Option<String>,
}

static PROXY_CONFIG: OnceLock<RwLock<ProxyConfig>> = OnceLock::new();

fn proxy_config() -> &'static RwLock<ProxyConfig> {
    PROXY_CONFIG.get_or_init(|| RwLock::new(ProxyConfig::default()))
}

/// 按当前代理偏好构建 reqwest 客户端（工具链下载等 Rust 侧网络请求共用）。
pub fn configure_client(builder: reqwest::ClientBuilder) -> Result<reqwest::Client, String> {
    let builder = {
        let Ok(config) = proxy_config().read() else {
            return builder
                .build()
                .map_err(|error| format!("创建 HTTP 客户端失败: {error}"));
        };
        match config.mode {
            ProxyMode::System => builder,
            ProxyMode::None => builder.no_proxy(),
            ProxyMode::Custom => match config.url.as_deref() {
                Some(url) => {
                    let proxy = reqwest::Proxy::all(url)
                        .map_err(|error| format!("代理地址无效: {error}"))?;
                    builder.proxy(proxy)
                }
                None => builder,
            },
        }
    };
    builder
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败: {error}"))
}

fn parse_proxy_url(url: &str) -> Result<(), String> {
    reqwest::Proxy::all(url)
        .map(|_| ())
        .map_err(|error| format!("代理地址无效: {error}"))
}

/// 更新代理偏好；custom 模式要求非空且可解析的代理地址（socks5 需 reqwest socks 特性支持，
/// 未启用时会在校验阶段给出明确错误）。
#[tauri::command]
pub fn set_network_proxy(mode: String, url: Option<String>) -> Result<(), String> {
    let mode = match mode.as_str() {
        "system" => ProxyMode::System,
        "custom" => ProxyMode::Custom,
        "none" => ProxyMode::None,
        other => return Err(format!("未知的代理模式: {other}")),
    };

    let normalized = url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if mode == ProxyMode::Custom {
        match normalized.as_deref() {
            Some(value) => parse_proxy_url(value)?,
            None => return Err("自定义代理模式需要提供代理地址".to_string()),
        }
    }

    let mut config = proxy_config()
        .write()
        .map_err(|_| "代理配置状态被占用".to_string())?;
    config.mode = mode;
    config.url = normalized;
    Ok(())
}

/// 扩展安装包下载大小上限（200 MB），防止误配地址拖爆内存
pub const HTTP_FETCH_MAX_BYTES: usize = 200 * 1024 * 1024;

#[derive(Debug, serde::Serialize)]
pub struct FetchedBytes {
    pub data_b64: String,
    pub sha256: Option<String>,
}

/// 仅允许 http/https，阻断 file:// 等本地 scheme 被当作下载地址
fn validate_http_url(url: &str) -> Result<(), String> {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Ok(())
    } else {
        Err("仅支持 http/https 下载地址".to_string())
    }
}

/// 下载任意 http(s) 资源为 base64（Marketplace 扩展安装走此命令，
/// 与工具链下载共用同一代理偏好 configure_client）
#[tauri::command]
pub async fn http_fetch_bytes(url: String) -> Result<FetchedBytes, String> {
    validate_http_url(&url)?;
    let client = configure_client(reqwest::Client::builder())?;
    let response = client
        .get(url.trim())
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|error| format!("下载请求失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "下载安装包失败 (HTTP {})",
            response.status().as_u16()
        ));
    }
    let sha256 = response
        .headers()
        .get("X-Aurona-Extension-Sha256")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if let Some(length) = response.content_length() {
        if length as usize > HTTP_FETCH_MAX_BYTES {
            return Err("安装包超出下载大小上限".to_string());
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取下载数据失败: {error}"))?;
    if bytes.len() > HTTP_FETCH_MAX_BYTES {
        return Err("安装包超出下载大小上限".to_string());
    }
    use base64::Engine as _;
    Ok(FetchedBytes {
        data_b64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        sha256,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_network_proxy_rejects_unknown_mode() {
        assert!(set_network_proxy("magic".to_string(), None).is_err());
    }

    #[test]
    fn set_network_proxy_custom_requires_url() {
        assert!(set_network_proxy("custom".to_string(), None).is_err());
        assert!(set_network_proxy("custom".to_string(), Some("  ".to_string())).is_err());
        assert!(set_network_proxy("custom".to_string(), Some("not a url".to_string())).is_err());
    }

    #[test]
    fn set_network_proxy_accepts_valid_http_proxy() {
        assert!(set_network_proxy(
            "custom".to_string(),
            Some("http://127.0.0.1:7897".to_string())
        )
        .is_ok());
        assert!(set_network_proxy("system".to_string(), None).is_ok());
        assert!(set_network_proxy("none".to_string(), None).is_ok());
        // 恢复默认，避免污染其他测试的全局状态
        assert!(set_network_proxy("system".to_string(), None).is_ok());
    }

    #[test]
    fn configure_client_none_mode_forces_direct() {
        assert!(set_network_proxy("none".to_string(), None).is_ok());
        let builder = reqwest::Client::builder();
        assert!(crate::network::configure_client(builder).is_ok());
        assert!(set_network_proxy("system".to_string(), None).is_ok());
    }

    #[test]
    fn validate_http_url_blocks_non_http_schemes() {
        assert!(validate_http_url("https://marketplace.aurona.cc/api/x/download").is_ok());
        assert!(validate_http_url("http://127.0.0.1:5219/api/x/download").is_ok());
        assert!(validate_http_url("file://C:/Windows/system32/pwn.dll").is_err());
        assert!(validate_http_url("ftp://example.com/pkg").is_err());
        assert!(validate_http_url("  ").is_err());
    }
}
