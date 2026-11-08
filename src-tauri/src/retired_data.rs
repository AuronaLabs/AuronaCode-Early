//! Narrow, retryable removal of credentials left by pre-0.5 builds.
pub fn clean() {
    #[cfg(not(feature = "audit-harness"))]
    let service = "cc.aurona.code.account";
    #[cfg(feature = "audit-harness")]
    let service = "cc.aurona.code.audit0414.account";
    let result = keyring::Entry::new(service, "aurona-account-refresh-token")
        .and_then(|entry| entry.delete_credential());
    if let Err(error) = result {
        if !matches!(error, keyring::Error::NoEntry) {
            eprintln!("[migration.retired_credential] Cleanup will retry on next launch");
        }
    }
}
