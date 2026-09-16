use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspManifestRuntime {
    #[serde(rename = "type")]
    pub runtime_type: String,
    pub min_version: Option<String>,
    pub entry: String,
    pub exec_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspManifestCommand {
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspPackageManifest {
    #[serde(default)]
    pub schema_version: Option<u32>,
    pub kind: Option<String>,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: Option<HashMap<String, String>>,
    pub version: String,
    #[serde(default)]
    pub languages: Vec<String>,
    pub runtime: LspManifestRuntime,
    #[serde(default)]
    pub command: Option<LspManifestCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePackageManifest {
    #[serde(default)]
    pub schema_version: Option<u32>,
    pub kind: Option<String>,
    pub id: String,
    pub version: String,
    pub runtime_type: String,
    pub runtime_version: String,
    pub binary_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledToolchainSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub languages: Vec<String>,
    pub runtime_type: String,
    pub install_path: String,
    pub disk_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRuntimeSummary {
    pub runtime_type: String,
    pub version: String,
    pub binary_path: String,
    pub disk_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainsOverview {
    pub servers: Vec<InstalledToolchainSummary>,
    pub runtimes: Vec<InstalledRuntimeSummary>,
    pub total_bytes: u64,
}

pub fn get_toolchains_base_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法获取 AppLocalData 目录: {e}"))?;
    let dir = local_data.join("toolchains");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建 toolchains 目录: {e}"))?;
    Ok(dir)
}

fn calculate_directory_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += calculate_directory_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

fn runtime_binary_path(base: &Path, relative_path: &str) -> Option<PathBuf> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return None;
    }
    Some(base.join(relative))
}

fn installed_runtime_summary(
    directory_runtime_type: &str,
    directory_version: &str,
    install_path: &Path,
) -> InstalledRuntimeSummary {
    let manifest = fs::read_to_string(install_path.join("manifest.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<RuntimePackageManifest>(&content).ok());

    let runtime_type = manifest
        .as_ref()
        .map(|value| value.runtime_type.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(directory_runtime_type)
        .to_string();
    let version = manifest
        .as_ref()
        .map(|value| value.runtime_version.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(directory_version)
        .to_string();
    let configured_binary = manifest
        .as_ref()
        .and_then(|value| runtime_binary_path(install_path, &value.binary_path));
    let fallback_binary = if cfg!(windows) { "node.exe" } else { "node" };
    let effective_binary = configured_binary.unwrap_or_else(|| {
        let bin = install_path.join("bin").join(fallback_binary);
        if bin.exists() {
            bin
        } else {
            install_path.join(fallback_binary)
        }
    });

    InstalledRuntimeSummary {
        runtime_type,
        version,
        binary_path: effective_binary.to_string_lossy().to_string(),
        disk_size_bytes: calculate_directory_size(install_path),
    }
}

/// 在 APPDATA 共享运行时池中解析 Node.js 运行时可执行路径
pub fn find_shared_node_runtime(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let base = get_toolchains_base_dir(app_handle).ok()?;
    let runtimes_node = base.join("runtimes").join("node");
    let exe_name = if cfg!(windows) { "node.exe" } else { "node" };

    if runtimes_node.exists() {
        if let Ok(versions) = fs::read_dir(&runtimes_node) {
            for v_entry in versions.flatten() {
                let v_path = v_entry.path();
                if v_path.is_dir() {
                    // 候选路径 1: <version>/bin/node.exe
                    let bin_exe = v_path.join("bin").join(exe_name);
                    if bin_exe.is_file() {
                        return Some(bin_exe);
                    }
                    // 候选路径 2: <version>/node.exe
                    let root_exe = v_path.join(exe_name);
                    if root_exe.is_file() {
                        return Some(root_exe);
                    }
                }
            }
        }
    }

    None
}

/// 根据语言标识在 APPDATA 已安装语言服务池中查找对应 LSP
pub fn find_installed_lsp_for_language(
    app_handle: &tauri::AppHandle,
    language: &str,
) -> Option<(LspPackageManifest, PathBuf)> {
    let base = get_toolchains_base_dir(app_handle).ok()?;
    let servers_dir = base.join("servers");
    if !servers_dir.exists() {
        return None;
    }

    let target_lang = language.to_lowercase();

    if let Ok(servers) = fs::read_dir(&servers_dir) {
        for s_entry in servers.flatten() {
            let s_path = s_entry.path();
            if s_path.is_dir() {
                if let Ok(versions) = fs::read_dir(&s_path) {
                    for v_entry in versions.flatten() {
                        let v_path = v_entry.path();
                        if v_path.is_dir() {
                            let manifest_path = v_path.join("manifest.json");
                            if manifest_path.is_file() {
                                if let Ok(content) = fs::read_to_string(&manifest_path) {
                                    if let Ok(manifest) =
                                        serde_json::from_str::<LspPackageManifest>(&content)
                                    {
                                        if manifest
                                            .languages
                                            .iter()
                                            .any(|l| l.to_lowercase() == target_lang)
                                        {
                                            return Some((manifest, v_path));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainProgressPayload {
    pub download_id: String,
    pub stage: String, // "downloading" | "extracting" | "completed" | "failed"
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub message: Option<String>,
}

/// 从本地文件流式解压安装 LSP 语言服务包或共享运行时包（0 内存峰值）
pub fn install_toolchain_file(
    app_handle: &tauri::AppHandle,
    file_path: &Path,
    expected_sha256: Option<&str>,
) -> Result<InstalledToolchainSummary, String> {
    let file = File::open(file_path).map_err(|e| format!("打开安装包文件失败: {e}"))?;

    // 1. SHA-256 校验
    if let Some(expected) = expected_sha256 {
        let expected_clean = expected.trim().to_lowercase();
        if !expected_clean.is_empty() {
            let mut hasher = Sha256::new();
            let mut check_file = File::open(file_path).map_err(|e| format!("校验文件失败: {e}"))?;
            let mut buf = [0u8; 64 * 1024];
            loop {
                let n = check_file
                    .read(&mut buf)
                    .map_err(|e| format!("读取文件校验哈希失败: {e}"))?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
            }
            let actual = format!("{:x}", hasher.finalize());
            if actual != expected_clean {
                return Err(format!(
                    "SHA-256 校验未通过：期望 {expected_clean}，实际计算为 {actual}。安装已被安全中止"
                ));
            }
        }
    }

    let mut zip = ZipArchive::new(file).map_err(|e| format!("无法解压归档包: {e}"))?;

    // 2. 读取 manifest.json
    let manifest_bytes = {
        let mut f = zip
            .by_name("manifest.json")
            .map_err(|_| "安装包根目录缺少 manifest.json 清单文件".to_string())?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)
            .map_err(|e| format!("读取 manifest.json 失败: {e}"))?;
        buf
    };

    let manifest_val: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("manifest.json 格式错误: {e}"))?;

    let kind = manifest_val
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("lsp")
        .to_lowercase();

    let id = manifest_val
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "manifest.json 缺少 id".to_string())?;

    let version = manifest_val
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("1.0.0");

    let base = get_toolchains_base_dir(app_handle)?;

    let target_dir = if kind == "runtime" {
        let r_type = manifest_val
            .get("runtimeType")
            .and_then(|v| v.as_str())
            .unwrap_or("node");
        base.join("runtimes").join(r_type).join(version)
    } else {
        base.join("servers").join(id).join(version)
    };

    // 清理旧版本目录并重建
    if target_dir.exists() {
        let _ = fs::remove_dir_all(&target_dir);
    }
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("无法创建目标目录 {}: {e}", target_dir.display()))?;

    // 3. 安全解压文件 (防 ZipSlip 越界)
    for i in 0..zip.len() {
        let mut f = zip
            .by_index(i)
            .map_err(|e| format!("读取文件条目异常: {e}"))?;
        let rel_path = f
            .enclosed_name()
            .ok_or_else(|| "包内包含潜在逃逸危险路径".to_string())?
            .to_owned();

        let out_path = target_dir.join(&rel_path);
        if f.name().ends_with('/') || f.is_dir() {
            fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut outfile = File::create(&out_path)
                .map_err(|e| format!("创建文件失败 {}: {e}", out_path.display()))?;
            std::io::copy(&mut f, &mut outfile)
                .map_err(|e| format!("写入文件失败 {}: {e}", out_path.display()))?;
        }
    }

    // 4. 自动兼容修补 pyright 内部相对路径问题
    let index_cjs = target_dir.join("dist").join("langserver.index.cjs");
    if index_cjs.is_file() {
        if let Ok(content) = fs::read_to_string(&index_cjs) {
            if content.contains("require('./dist/pyright-langserver')") {
                let fixed = content.replace(
                    "require('./dist/pyright-langserver')",
                    "try { require('./pyright-langserver'); } catch (e) { require('./dist/pyright-langserver'); }",
                );
                let _ = fs::write(&index_cjs, fixed);
            }
        }
    }

    #[cfg(unix)]
    {
        if kind == "runtime" {
            use std::os::unix::fs::PermissionsExt;
            let bin_dir = target_dir.join("bin");
            if bin_dir.exists() {
                if let Ok(entries) = fs::read_dir(bin_dir) {
                    for entry in entries.flatten() {
                        let _ =
                            fs::set_permissions(entry.path(), fs::Permissions::from_mode(0o755));
                    }
                }
            }
        }
    }

    let disk_size = calculate_directory_size(&target_dir);
    let name = manifest_val
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(id)
        .to_string();

    let languages = manifest_val
        .get("languages")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let runtime_type = manifest_val
        .get("runtime")
        .and_then(|r| r.get("type"))
        .and_then(|t| t.as_str())
        .unwrap_or("node")
        .to_string();

    Ok(InstalledToolchainSummary {
        id: id.to_string(),
        name,
        version: version.to_string(),
        languages,
        runtime_type,
        install_path: target_dir.to_string_lossy().to_string(),
        disk_size_bytes: disk_size,
    })
}

/// 异步流式下载并安装 LSP 或共享运行时（原生流式落盘，进度精确广播，零内存压力）
pub async fn install_toolchain_from_url(
    app_handle: tauri::AppHandle,
    download_id: String,
    url: String,
    expected_sha256: Option<String>,
) -> Result<InstalledToolchainSummary, String> {
    use tauri::Emitter;
    use tokio::io::AsyncWriteExt;

    // 1. 发起网络请求（按用户代理偏好修饰客户端：system/custom/none）
    let client = crate::network::configure_client(
        reqwest::Client::builder().timeout(std::time::Duration::from_secs(300)),
    )?;

    let mut res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("下载响应错误: HTTP {}", res.status()));
    }

    let total_bytes = res.content_length().unwrap_or(0);

    // 2. 创建临时文件
    let temp_dir = std::env::temp_dir().join("aurona_downloads");
    tokio::fs::create_dir_all(&temp_dir).await.ok();
    let temp_file_path = temp_dir.join(format!("{}.tmp", sanitize_filename(&download_id)));

    let mut dest = tokio::fs::File::create(&temp_file_path)
        .await
        .map_err(|e| format!("创建临时文件失败: {e}"))?;

    // 3. 流式写入与进度派发
    let mut downloaded_bytes = 0u64;
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("读取下载数据流中断: {e}"))?
    {
        dest.write_all(&chunk)
            .await
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        downloaded_bytes += chunk.len() as u64;

        if last_emit.elapsed().as_millis() > 60 || downloaded_bytes == total_bytes {
            last_emit = std::time::Instant::now();
            let percentage = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            };

            let _ = app_handle.emit(
                "toolchain://download_progress",
                ToolchainProgressPayload {
                    download_id: download_id.clone(),
                    stage: "downloading".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    percentage,
                    message: Some(format!(
                        "已下载 {:.1} MB / {:.1} MB",
                        downloaded_bytes as f64 / 1_048_576.0,
                        total_bytes as f64 / 1_048_576.0
                    )),
                },
            );
        }
    }

    dest.flush().await.ok();
    drop(dest);

    // 4. 派发解压中状态
    let _ = app_handle.emit(
        "toolchain://download_progress",
        ToolchainProgressPayload {
            download_id: download_id.clone(),
            stage: "extracting".to_string(),
            downloaded_bytes: total_bytes,
            total_bytes,
            percentage: 100.0,
            message: Some("正在解压并部署环境...".to_string()),
        },
    );

    // 5. 异步后台线程解压并安装，不阻塞 tokio runtime
    let app_clone = app_handle.clone();
    let temp_clone = temp_file_path.clone();
    let expected_clone = expected_sha256.clone();
    let summary_res = tokio::task::spawn_blocking(move || {
        install_toolchain_file(&app_clone, &temp_clone, expected_clone.as_deref())
    })
    .await
    .map_err(|e| format!("执行解压任务失败: {e}"))?;

    // 6. 清理临时文件
    let _ = tokio::fs::remove_file(&temp_file_path).await;

    match summary_res {
        Ok(summary) => {
            let _ = app_handle.emit(
                "toolchain://download_progress",
                ToolchainProgressPayload {
                    download_id: download_id.clone(),
                    stage: "completed".to_string(),
                    downloaded_bytes: total_bytes,
                    total_bytes,
                    percentage: 100.0,
                    message: Some("安装完成".to_string()),
                },
            );
            Ok(summary)
        }
        Err(err) => {
            let _ = app_handle.emit(
                "toolchain://download_progress",
                ToolchainProgressPayload {
                    download_id: download_id.clone(),
                    stage: "failed".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    percentage: 0.0,
                    message: Some(err.clone()),
                },
            );
            Err(err)
        }
    }
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// 兼容内存字节数组安装
pub fn install_toolchain_archive(
    app_handle: &tauri::AppHandle,
    archive_bytes: &[u8],
    expected_sha256: Option<&str>,
) -> Result<InstalledToolchainSummary, String> {
    let temp_file = std::env::temp_dir().join(format!("aurona_mem_{}.tmp", rand::random::<u64>()));
    fs::write(&temp_file, archive_bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;
    let res = install_toolchain_file(app_handle, &temp_file, expected_sha256);
    let _ = fs::remove_file(&temp_file);
    res
}

/// 列出本地 APPDATA 已安装的所有工具链与共享运行时
pub fn list_all_installed_toolchains(app_handle: &tauri::AppHandle) -> ToolchainsOverview {
    let mut servers_res = Vec::new();
    let mut runtimes_res = Vec::new();

    let Ok(base) = get_toolchains_base_dir(app_handle) else {
        return ToolchainsOverview {
            servers: Vec::new(),
            runtimes: Vec::new(),
            total_bytes: 0,
        };
    };

    // 扫描 servers
    let servers_dir = base.join("servers");
    if servers_dir.exists() {
        if let Ok(s_entries) = fs::read_dir(&servers_dir) {
            for s_entry in s_entries.flatten() {
                let s_path = s_entry.path();
                if s_path.is_dir() {
                    if let Ok(v_entries) = fs::read_dir(&s_path) {
                        for v_entry in v_entries.flatten() {
                            let v_path = v_entry.path();
                            if v_path.is_dir() {
                                let manifest_p = v_path.join("manifest.json");
                                if manifest_p.is_file() {
                                    if let Ok(content) = fs::read_to_string(&manifest_p) {
                                        if let Ok(m) =
                                            serde_json::from_str::<LspPackageManifest>(&content)
                                        {
                                            let size = calculate_directory_size(&v_path);
                                            servers_res.push(InstalledToolchainSummary {
                                                id: m.id,
                                                name: m.name,
                                                version: m.version,
                                                languages: m.languages,
                                                runtime_type: m.runtime.runtime_type,
                                                install_path: v_path.to_string_lossy().to_string(),
                                                disk_size_bytes: size,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 扫描 runtimes
    let runtimes_dir = base.join("runtimes");
    if runtimes_dir.exists() {
        if let Ok(r_entries) = fs::read_dir(&runtimes_dir) {
            for r_entry in r_entries.flatten() {
                let r_path = r_entry.path();
                if r_path.is_dir() {
                    let r_type = r_entry.file_name().to_string_lossy().to_string();
                    if let Ok(v_entries) = fs::read_dir(&r_path) {
                        for v_entry in v_entries.flatten() {
                            let v_path = v_entry.path();
                            if v_path.is_dir() {
                                let v_name = v_entry.file_name().to_string_lossy().to_string();
                                runtimes_res
                                    .push(installed_runtime_summary(&r_type, &v_name, &v_path));
                            }
                        }
                    }
                }
            }
        }
    }

    let total = servers_res.iter().map(|s| s.disk_size_bytes).sum::<u64>()
        + runtimes_res.iter().map(|r| r.disk_size_bytes).sum::<u64>();

    ToolchainsOverview {
        servers: servers_res,
        runtimes: runtimes_res,
        total_bytes: total,
    }
}

/// 卸载指定的 LSP 语言服务
pub fn uninstall_toolchain_server(app_handle: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let base = get_toolchains_base_dir(app_handle)?;
    let server_dir = base.join("servers").join(id);
    if server_dir.exists() {
        fs::remove_dir_all(&server_dir).map_err(|e| format!("卸载语言服务 {id} 失败: {e}"))?;
    }
    Ok(())
}

/// 清理/卸载指定的共享运行时
pub fn uninstall_toolchain_runtime(
    app_handle: &tauri::AppHandle,
    runtime_type: &str,
) -> Result<(), String> {
    let base = get_toolchains_base_dir(app_handle)?;
    let runtime_dir = base.join("runtimes").join(runtime_type);
    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir)
            .map_err(|e| format!("卸载共享运行时 {runtime_type} 失败: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_runtime_summary_reads_the_local_manifest() {
        let directory = std::env::temp_dir().join(format!(
            "aurona-runtime-summary-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(directory.join("bin")).unwrap();
        std::fs::write(
            directory.join("manifest.json"),
            r#"{
              "schemaVersion": 1,
              "kind": "runtime",
              "id": "auronalabs.runtime-bun",
              "version": "1.1.0",
              "runtimeType": "bun",
              "runtimeVersion": "1.1.0",
              "binaryPath": "bin/bun"
            }"#,
        )
        .unwrap();
        std::fs::write(directory.join("bin").join("bun"), b"runtime").unwrap();

        let summary = installed_runtime_summary("node", "directory-version", &directory);

        assert_eq!(summary.runtime_type, "bun");
        assert_eq!(summary.version, "1.1.0");
        assert!(Path::new(&summary.binary_path).ends_with(Path::new("bin").join("bun")));
        assert!(summary.disk_size_bytes > 0);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn runtime_manifest_cannot_escape_its_install_directory() {
        assert!(runtime_binary_path(Path::new("runtime"), "../outside").is_none());
    }
}
