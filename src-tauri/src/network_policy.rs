use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use url::Url;

fn blocked_v4(ip: Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.octets()[0] == 0
        || ip.octets()[0] >= 240
        || (ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
        || (ip.octets()[0] == 198 && (18..=19).contains(&ip.octets()[1]))
        || (ip.octets()[0] == 192 && ip.octets()[1] == 0 && ip.octets()[2] == 0)
        || (ip.octets()[0] == 192 && ip.octets()[1] == 88 && ip.octets()[2] == 99)
}

fn blocked_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return blocked_v4(v4);
    }
    // Only globally routed unicast; transition mechanisms can embed private IPv4.
    (ip.segments()[0] & 0xe000) != 0x2000
        || ip.segments()[0] == 0x2002
        || (ip.segments()[0] == 0x2001 && ip.segments()[1] < 0x0200)
        || (ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8)
        || (ip.segments()[0] == 0x3fff && ip.segments()[1] < 0x1000)
}

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => !blocked_v4(ip),
        IpAddr::V6(ip) => !blocked_v6(ip),
    }
}

pub fn validate_ai_endpoint(raw: &str) -> Result<Url, String> {
    if raw.len() > 8192 {
        return Err("[network.url] Endpoint URL exceeds limit".into());
    }
    let url =
        Url::parse(raw.trim()).map_err(|_| "[network.url] Invalid endpoint URL".to_string())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
    {
        return Err("[network.url] Endpoint credentials, query and fragment are prohibited".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "[network.url] Missing host".to_string())?;
    let literal = host.trim_matches(['[', ']']).parse::<IpAddr>().ok();
    let loopback = host == "localhost" || literal.is_some_and(|ip| ip.is_loopback());
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(
            "[network.scheme] HTTPS is required except authorized loopback endpoints".into(),
        );
    }
    if host == "metadata.google.internal"
        || literal.is_some_and(|ip| !public_ip(ip) && !ip.is_loopback())
    {
        return Err("[network.address] Non-public endpoint address is prohibited".into());
    }
    Ok(url)
}

pub async fn ai_client(raw: &str) -> Result<reqwest::Client, String> {
    let url = validate_ai_endpoint(raw)?;
    pinned_client(&url).await
}

pub(crate) async fn pinned_client(url: &Url) -> Result<reqwest::Client, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "Missing endpoint host".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Invalid endpoint port".to_string())?;
    let addresses: Vec<_> = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        tokio::net::lookup_host((host.trim_matches(['[', ']']), port)),
    )
    .await
    .map_err(|_| "[network.dns_timeout] Endpoint DNS resolution timed out".to_string())?
    .map_err(|_| "[network.dns] Endpoint DNS resolution failed".to_string())?
    .collect();
    let loopback = host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if addresses.is_empty()
        || addresses.iter().any(|address| {
            if loopback {
                !address.ip().is_loopback()
            } else {
                !public_ip(address.ip())
            }
        })
    {
        return Err(
            "[network.address] Endpoint DNS resolved outside its authorized address class".into(),
        );
    }
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addresses)
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| "[network.client] Restricted HTTP client creation failed".into())
}

#[derive(Clone, Copy)]
pub enum DownloadPurpose {
    Extension,
    Toolchain,
    Debugpy,
    Update,
}

pub fn validate_download_url(raw: &str, purpose: DownloadPurpose) -> Result<Url, String> {
    if raw.len() > 8192 {
        return Err("[network.url] Download URL exceeds limit".into());
    }
    let url = Url::parse(raw).map_err(|_| "[network.url] Invalid download URL")?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("[network.url] Download URL userinfo and fragment are prohibited".into());
    }
    let host = url
        .host_str()
        .ok_or("[network.host] Missing download host")?;
    let github = matches!(
        host,
        "github.com" | "objects.githubusercontent.com" | "release-assets.githubusercontent.com"
    );
    let allowed = match purpose {
        DownloadPurpose::Extension => host == "marketplace.aurona.cc",
        DownloadPurpose::Toolchain => {
            host == "marketplace.aurona.cc" || host == "nodejs.org" || github
        }
        DownloadPurpose::Debugpy => host == "files.pythonhosted.org",
        DownloadPurpose::Update => github,
    };
    if url.scheme() != "https" || url.port_or_known_default() != Some(443) || !allowed {
        return Err("[network.source] Download source is not authorized".into());
    }
    if host == "github.com" && !url.path().starts_with("/AuronaLabs/") {
        return Err("[network.source] GitHub download is outside the official publisher".into());
    }
    if host == "files.pythonhosted.org" && !url.path().starts_with("/packages/") {
        return Err("[network.source] Python download is outside package storage".into());
    }
    Ok(url)
}

pub async fn download_response(
    raw: &str,
    purpose: DownloadPurpose,
) -> Result<reqwest::Response, String> {
    let mut url = validate_download_url(raw, purpose)?;
    for _ in 0..=5 {
        let client = pinned_client(&url).await?;
        let response = client
            .get(url.clone())
            .timeout(std::time::Duration::from_secs(300))
            .send()
            .await
            .map_err(|_| "[network.download] Download connection failed".to_string())?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("[network.redirect] Missing redirect location")?;
            let next = url
                .join(location)
                .map_err(|_| "[network.redirect] Invalid redirect URL")?;
            url = validate_download_url(next.as_str(), purpose)?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!(
                "[network.http] Download returned HTTP {}",
                response.status().as_u16()
            ));
        }
        return Ok(response);
    }
    Err("[network.redirect] Redirect limit exceeded".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_rejects_credentials_private_and_metadata() {
        for raw in [
            "http://example.com/v1",
            "https://user:secret@example.com",
            "https://169.254.169.254",
            "https://10.0.0.1",
            "https://[fc00::1]",
            "https://[::ffff:169.254.169.254]",
            "file:///tmp/key",
            "https://metadata.google.internal",
        ] {
            assert!(validate_ai_endpoint(raw).is_err(), "{raw}");
        }
        assert!(validate_ai_endpoint("https://api.openai.com/v1").is_ok());
        assert!(validate_ai_endpoint("http://127.0.0.1:1234/v1").is_ok());
    }

    #[test]
    fn non_global_ipv6_ranges_are_rejected_before_remote_requests() {
        for address in [
            "2001:db8::1",
            "3fff::1",
            "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff",
            "5f00::1",
        ] {
            assert!(!public_ip(address.parse().unwrap()), "{address}");
            assert!(validate_ai_endpoint(&format!("https://[{address}]/v1")).is_err());
        }
        for address in ["2001:4860:4860::8888", "2606:4700:4700::1111"] {
            assert!(public_ip(address.parse().unwrap()), "{address}");
            assert!(validate_ai_endpoint(&format!("https://[{address}]/v1")).is_ok());
        }
    }

    #[test]
    fn download_queries_do_not_relax_ai_or_source_policy() {
        assert!(validate_download_url(
            "https://release-assets.githubusercontent.com/asset?sig=abc&expires=123",
            DownloadPurpose::Update
        )
        .is_ok());
        assert!(validate_ai_endpoint("https://api.openai.com/v1?token=abc").is_err());
        for url in [
            "https://github.com/other/package",
            "https://evil.test/asset?sig=abc",
            "https://user:secret@nodejs.org/asset",
            "http://nodejs.org/asset",
        ] {
            assert!(validate_download_url(url, DownloadPurpose::Toolchain).is_err());
        }
    }

    #[test]
    fn download_sources_are_bound_to_purpose_across_redirects() {
        let marketplace = "https://marketplace.aurona.cc/artifacts/example.aurx";
        let python = "https://files.pythonhosted.org/packages/wheel.whl";
        let node = "https://nodejs.org/dist/node.zip";
        assert!(validate_download_url(marketplace, DownloadPurpose::Extension).is_ok());
        assert!(validate_download_url(python, DownloadPurpose::Debugpy).is_ok());
        assert!(validate_download_url(node, DownloadPurpose::Toolchain).is_ok());
        for purpose in [
            DownloadPurpose::Extension,
            DownloadPurpose::Toolchain,
            DownloadPurpose::Update,
        ] {
            assert!(validate_download_url(python, purpose).is_err());
        }
        assert!(validate_download_url(node, DownloadPurpose::Extension).is_err());
        assert!(validate_download_url(marketplace, DownloadPurpose::Update).is_err());
        assert!(validate_download_url(
            "https://marketplace.aurona.cc:8443/a",
            DownloadPurpose::Extension
        )
        .is_err());
        let redirect = url::Url::parse(marketplace).unwrap().join(python).unwrap();
        assert!(validate_download_url(redirect.as_str(), DownloadPurpose::Extension).is_err());
    }

    #[test]
    fn transition_and_reserved_addresses_are_not_public() {
        for ip in [
            "198.18.1.1",
            "192.0.0.1",
            "192.88.99.1",
            "2002:a00:1::",
            "2001::1",
            "2001:2::1",
            "fec0::1",
            "64:ff9b::a00:1",
            "::10.0.0.1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_ip("2001:4860:4860::8888".parse().unwrap()));
    }
}
