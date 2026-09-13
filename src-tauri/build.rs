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

    // tauri-build 默认通过 .res 资源只给 bin 目标嵌入应用清单（Common-Controls 6
    // 依赖），测试二进制拿不到清单，comctl32 会解析到 System32 的 5.82 版（无
    // TaskDialogIndirect 导出，tauri-plugin-dialog/rfd 需要它），`cargo test` 的
    // 测试进程启动即报 STATUS_ENTRYPOINT_NOT_FOUND。
    // 因此改为：bin 不由 tauri-build 嵌清单，统一用 rustc-link-arg 为所有链接
    // 目标（含 bin 与测试）嵌入同一份清单（tauri crate 自身测试亦用此方案）。
    // 仅 Windows 目标注入：/MANIFEST:* 是 MSVC 链接器专属参数，传给 Unix 的
    // cc/rust-lld 会被当作输入文件导致链接失败。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let app_manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("windows")
            .join("app-manifest.xml");
        println!("cargo:rerun-if-changed={}", app_manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
            app_manifest.display()
        );
    }

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
    )
    .expect("tauri-build 执行失败");
}
