fn main() {
    // Aurona Code is an open-source project: the Aurona Account client id is a
    // public, per-build configuration value. It is never committed to source.
    // Local development reads a gitignored `.env` file at the repository root;
    // CI/release builds inject `AURONA_ACCOUNT_CLIENT_ID` through the workflow
    // environment. Existing environment variables always win over `.env`.
    let _ = dotenvy::dotenv();

    for variable in [
        "AURONA_ACCOUNT_CLIENT_ID",
        "AURONA_ACCOUNT_DISCOVERY_URL",
        "AURONA_ACCOUNT_EXPECTED_ISSUER",
        "AURONA_ACCOUNT_ALLOW_INSECURE_LOOPBACK_PROVIDER",
    ] {
        if let Ok(value) = std::env::var(variable) {
            println!("cargo:rustc-env={variable}={value}");
        }
    }

    tauri_build::build()
}
