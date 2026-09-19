use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

pub const MAX_ARCHIVE_BYTES: u64 = 48 * 1024 * 1024;
pub const MAX_ENTRY_COUNT: usize = 64;
pub const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
pub const MAX_WASM_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_VIEW_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_ICON_BYTES: u64 = 2 * 1024 * 1024;

const MANIFEST_PATH: &str = "manifest.json";
const WASM_PATH: &str = "extension.wasm";
const VIEW_PATH: &str = "ui/index.html";
const ICON_PATH: &str = "assets/icon.svg";
const EXPECTED_PATHS: [&str; 4] = [MANIFEST_PATH, WASM_PATH, VIEW_PATH, ICON_PATH];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub package_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: Option<HashMap<String, String>>,
    pub publisher: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub display_description: Option<HashMap<String, String>>,
    #[serde(default)]
    pub readme: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
    pub engine: EngineRequirement,
    pub runtime: RuntimeEntry,
    pub sidebar: SidebarEntry,
    pub view: ViewEntry,
    /// 扩展声明它需要的权限（安装期由 permissions::validate_declared 审查）。
    /// 旧包没有该字段时按"未声明"处理，运行时仍可主动请求。
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub marketplace: Option<MarketplaceMetadata>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceMetadata {
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub rating: Option<f32>,
    #[serde(default)]
    pub downloads: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRequirement {
    pub aurona_code: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEntry {
    pub component: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarEntry {
    pub title: String,
    #[serde(default)]
    pub display_title: Option<HashMap<String, String>>,
    pub icon: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewEntry {
    pub entry: String,
}

#[derive(Debug, Clone)]
pub struct ExtensionPackage {
    pub manifest: ExtensionManifest,
    #[allow(dead_code)] // consumed by the extension runtime in later phases
    pub wasm: Vec<u8>,
    pub view_html: String,
    #[allow(dead_code)] // consumed by the extension view host in later phases
    pub icon_svg: String,
    /// VSCode 兼容包的主入口 JS 源码（.vsix 路径专用；AURX 包恒为空）。
    pub js_source: String,
}

impl ExtensionPackage {
    pub fn id(&self) -> &str {
        &self.manifest.id
    }
}

fn is_safe_relative_path(name: &str) -> bool {
    if name.is_empty()
        || name.starts_with('/')
        || name.starts_with('\\')
        || name.contains('\\')
        || name.ends_with('/')
    {
        return false;
    }
    let mut depth = 0usize;
    for part in name.split('/') {
        match part {
            "" | "." => return false,
            ".." => return false,
            _ => depth += 1,
        }
    }
    depth > 0
}

fn looks_like_drive_or_unc(name: &str) -> bool {
    let bytes = name.as_bytes();
    (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || name.starts_with("//")
}

/// Scans the ZIP central directory directly so duplicate entry names are
/// rejected even though `zip::ZipArchive` internally indexes by name and would
/// silently hide exact duplicates.
fn check_duplicate_paths(archive_bytes: &[u8]) -> Result<(), String> {
    const EOCD_SIGNATURE: &[u8; 4] = b"PK\x05\x06";
    const CDFH_SIGNATURE: &[u8; 4] = b"PK\x01\x02";

    let Some(eocd) = archive_bytes
        .windows(4)
        .rposition(|window| window == EOCD_SIGNATURE)
    else {
        return Err("AURX 缺少 ZIP 中央目录结束标记".to_string());
    };
    if eocd + 22 > archive_bytes.len() {
        return Err("AURX 中央目录结束标记越界".to_string());
    }

    let entry_count = u16::from_le_bytes(
        archive_bytes[eocd + 10..eocd + 12]
            .try_into()
            .map_err(|_| "AURX entry 数量读取失败".to_string())?,
    ) as usize;
    if entry_count > MAX_ENTRY_COUNT {
        return Err(format!("AURX entry 数量超过上限: {entry_count}"));
    }
    let central_offset = u32::from_le_bytes(
        archive_bytes[eocd + 16..eocd + 20]
            .try_into()
            .map_err(|_| "AURX 中央目录偏移读取失败".to_string())?,
    ) as usize;

    let mut seen = HashSet::new();
    let mut position = central_offset;
    for _ in 0..entry_count {
        if position + 46 > archive_bytes.len()
            || &archive_bytes[position..position + 4] != CDFH_SIGNATURE
        {
            return Err("AURX 中央目录已损坏".to_string());
        }
        let name_length = u16::from_le_bytes(
            archive_bytes[position + 28..position + 30]
                .try_into()
                .map_err(|_| "AURX 文件名长度读取失败".to_string())?,
        ) as usize;
        let extra_length = u16::from_le_bytes(
            archive_bytes[position + 30..position + 32]
                .try_into()
                .map_err(|_| "AURX 额外字段长度读取失败".to_string())?,
        ) as usize;
        let comment_length = u16::from_le_bytes(
            archive_bytes[position + 32..position + 34]
                .try_into()
                .map_err(|_| "AURX 注释长度读取失败".to_string())?,
        ) as usize;
        let name_end = position + 46 + name_length;
        if name_end > archive_bytes.len() {
            return Err("AURX 中央目录文件名越界".to_string());
        }
        let name = String::from_utf8_lossy(&archive_bytes[position + 46..name_end]);
        if !seen.insert(name.to_ascii_lowercase()) {
            return Err(format!("AURX 包含重复路径: {name}"));
        }
        position = name_end + extra_length + comment_length;
    }
    Ok(())
}

fn validate_manifest(manifest: &ExtensionManifest) -> Result<(), String> {
    if manifest.package_version != 1 {
        return Err(format!(
            "不支持的 AURX packageVersion: {}",
            manifest.package_version
        ));
    }
    if manifest.id.is_empty()
        || manifest.name.is_empty()
        || manifest.publisher.is_empty()
        || manifest.version.is_empty()
    {
        return Err("AURX manifest 缺少 id/name/publisher/version".to_string());
    }
    // id 字符集：小写字母 / 数字 / 点（命名空间分隔）/ 连字符（如 aurona.vscode-compat）。
    // 连字符此前被误拒，导致内置 VSCode 兼容层从未进入注册表（"兼容层未就绪"的根因）。
    if !manifest
        .id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-')
        || !manifest.id.contains('.')
    {
        return Err(format!("AURX id 不合法: {}", manifest.id));
    }
    if manifest.engine.aurona_code.is_empty() {
        return Err("AURX manifest 缺少 engine.auronaCode".to_string());
    }
    if manifest.runtime.component != WASM_PATH {
        return Err(format!(
            "AURX runtime.component 必须为 {WASM_PATH}，实际为 {}",
            manifest.runtime.component
        ));
    }
    if manifest.sidebar.title.is_empty() || manifest.sidebar.icon != ICON_PATH {
        return Err("AURX sidebar.title/icon 不合法".to_string());
    }
    if manifest.view.entry != VIEW_PATH {
        return Err(format!(
            "AURX view.entry 必须为 {VIEW_PATH}，实际为 {}",
            manifest.view.entry
        ));
    }
    // 权限审查：声明了不存在的权限或当前版本未开放的权限，直接拒绝加载/安装
    super::permissions::validate_declared(&manifest.permissions)?;
    Ok(())
}

/// Opens and validates an in-memory AURX archive. No entries are ever
/// extracted to disk; every entry is validated and capped before being read.
pub fn open_package(archive_bytes: &[u8]) -> Result<Arc<ExtensionPackage>, String> {
    if archive_bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "AURX 包超过大小上限: {} bytes",
            archive_bytes.len()
        ));
    }
    check_duplicate_paths(archive_bytes)?;

    let reader = Cursor::new(archive_bytes);
    let mut archive =
        ZipArchive::new(reader).map_err(|error| format!("AURX 不是有效的 ZIP 归档: {error}"))?;

    if archive.len() > MAX_ENTRY_COUNT {
        return Err(format!("AURX entry 数量超过上限: {}", archive.len()));
    }

    let mut seen_lower = HashSet::new();
    let mut manifest_bytes: Option<Vec<u8>> = None;
    let mut wasm_bytes: Option<Vec<u8>> = None;
    let mut view_bytes: Option<Vec<u8>> = None;
    let mut icon_bytes: Option<Vec<u8>> = None;
    let mut total_uncompressed: u64 = 0;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取 AURX entry 失败: {error}"))?;
        let name = entry.name().to_string();

        if !is_safe_relative_path(&name) || looks_like_drive_or_unc(&name) {
            return Err(format!("AURX 包含不安全的路径: {name}"));
        }
        if !seen_lower.insert(name.to_ascii_lowercase()) {
            return Err(format!("AURX 包含重复路径: {name}"));
        }
        if !EXPECTED_PATHS.contains(&name.as_str()) {
            return Err(format!("AURX 包含未知文件: {name}"));
        }
        if entry.is_dir() {
            return Err(format!("AURX 路径不应是目录: {name}"));
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!("AURX 包含符号链接: {name}"));
        }

        let uncompressed = entry.size();
        total_uncompressed += uncompressed;
        if total_uncompressed > MAX_ARCHIVE_BYTES {
            return Err("AURX 解压后总大小超过上限".to_string());
        }
        let cap = match name.as_str() {
            MANIFEST_PATH => MAX_MANIFEST_BYTES,
            WASM_PATH => MAX_WASM_BYTES,
            VIEW_PATH => MAX_VIEW_BYTES,
            ICON_PATH => MAX_ICON_BYTES,
            _ => unreachable!(),
        };
        if uncompressed > cap {
            return Err(format!("AURX 文件超过大小上限: {name}"));
        }

        let mut buffer = Vec::with_capacity(uncompressed as usize);
        entry
            .read_to_end(&mut buffer)
            .map_err(|error| format!("读取 AURX 文件失败 {name}: {error}"))?;
        if buffer.len() as u64 != uncompressed {
            return Err(format!("AURX 文件大小不一致: {name}"));
        }
        if crc32fast::hash(&buffer) != entry.crc32() {
            return Err(format!("AURX 文件校验失败: {name}"));
        }

        match name.as_str() {
            MANIFEST_PATH => manifest_bytes = Some(buffer),
            WASM_PATH => wasm_bytes = Some(buffer),
            VIEW_PATH => view_bytes = Some(buffer),
            ICON_PATH => icon_bytes = Some(buffer),
            _ => unreachable!(),
        }
    }

    let manifest = manifest_bytes.ok_or_else(|| "AURX 缺少 manifest.json".to_string())?;
    let manifest: ExtensionManifest = serde_json::from_slice(&manifest)
        .map_err(|error| format!("AURX manifest.json 无效: {error}"))?;
    validate_manifest(&manifest)?;

    let wasm = wasm_bytes.ok_or_else(|| "AURX 缺少 extension.wasm".to_string())?;
    if wasm.len() < 4 || &wasm[..4] != b"\0asm" {
        return Err("extension.wasm 不是有效的 WebAssembly 二进制".to_string());
    }
    let view_html =
        String::from_utf8(view_bytes.ok_or_else(|| "AURX 缺少 ui/index.html".to_string())?)
            .map_err(|_| "ui/index.html 不是有效 UTF-8".to_string())?;
    let icon_svg =
        String::from_utf8(icon_bytes.ok_or_else(|| "AURX 缺少 assets/icon.svg".to_string())?)
            .map_err(|_| "assets/icon.svg 不是有效 UTF-8".to_string())?;

    Ok(Arc::new(ExtensionPackage {
        manifest,
        wasm,
        view_html,
        icon_svg,
        js_source: String::new(),
    }))
}

#[allow(dead_code)]
#[derive(Debug, Default, Deserialize)]
struct VsCodeContributes {
    #[serde(default)]
    commands: Vec<serde_json::Value>,
    #[serde(default)]
    languages: Vec<serde_json::Value>,
    #[serde(default)]
    snippets: Vec<serde_json::Value>,
    #[serde(default)]
    themes: Vec<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct VsCodePackageJson {
    name: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    publisher: Option<String>,
    version: Option<String>,
    description: Option<String>,
    #[serde(default)]
    main: Option<String>,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    contributes: Option<VsCodeContributes>,
}

/// VSIX 包内单个 entry 的解压上限（§5.3.2：真执行 JS 前必须补齐安全项）。
pub const MAX_VSIX_ENTRY_BYTES: u64 = 8 * 1024 * 1024;
/// VSIX 主入口 JS 的额外约束：小于单 entry 通用上限即可视为拒绝超大脚本。
const VSIX_JS_HARD_LIMIT: u64 = MAX_VSIX_ENTRY_BYTES;

/// 校验 VSIX entry 名，阻断 zip-slip / 绝对路径 / 反斜杠分隔符。
fn ensure_safe_vsix_entry_name(name: &str) -> Result<(), String> {
    if name.starts_with('[') {
        // 允许 VSCode 标准的 "[Content_Types].xml" 元数据文件。
        return Ok(());
    }
    if !is_safe_relative_path(name) || looks_like_drive_or_unc(name) {
        return Err(format!("VSIX 包含不安全路径: {name}"));
    }
    Ok(())
}

/// 从 VSIX 归档中按 package.json 的 `main` 字段定位并读取主入口 JS。
fn read_vsix_entry_bytes(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    wanted: &dyn Fn(&str) -> bool,
    description: &str,
) -> Result<Option<String>, String> {
    let mut found: Option<(usize, u64)> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("读取 VSIX entry 失败: {error}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        ensure_safe_vsix_entry_name(&name)?;
        let uncompressed = entry.size();
        if uncompressed > MAX_VSIX_ENTRY_BYTES {
            return Err(format!("VSIX 文件超过大小上限: {name}"));
        }
        if wanted(&name) {
            found = Some((index, uncompressed));
            break;
        }
    }
    let Some((index, uncompressed)) = found else {
        return Ok(None);
    };
    let mut entry = archive
        .by_index(index)
        .map_err(|error| format!("读取 VSIX entry 失败: {error}"))?;
    if uncompressed > VSIX_JS_HARD_LIMIT {
        return Err(format!("VSIX {description} 超过大小上限"));
    }
    let mut buffer = Vec::with_capacity(uncompressed as usize);
    entry
        .read_to_end(&mut buffer)
        .map_err(|error| format!("读取 VSIX {description} 失败: {error}"))?;
    if buffer.len() as u64 != uncompressed {
        return Err(format!("VSIX 文件大小不一致: {description}"));
    }
    if crc32fast::hash(&buffer) != entry.crc32() {
        return Err(format!("VSIX 文件校验失败: {description}"));
    }
    String::from_utf8(buffer)
        .map(Some)
        .map_err(|_| format!("VSIX {description} 不是有效的 UTF-8 文本"))
}

/// 解析与加载标准 VSCode 插件包 (.vsix)
pub fn open_vsix_package(archive_bytes: &[u8]) -> Result<Arc<ExtensionPackage>, String> {
    if archive_bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "VSIX 包超过大小上限: {} bytes",
            archive_bytes.len()
        ));
    }
    let reader = Cursor::new(archive_bytes);
    let mut archive =
        ZipArchive::new(reader).map_err(|error| format!("VSIX 不是有效的 ZIP 归档: {error}"))?;
    if archive.len() > MAX_ENTRY_COUNT {
        return Err(format!("VSIX entry 数量超过上限: {}", archive.len()));
    }

    // 第一遍：全量安全校验 + 定位 package.json（§5.3.2 zip-slip / entry 上限）。
    let mut manifest_index: Option<usize> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("读取 VSIX entry 失败: {error}"))?;
        let name = entry.name().to_string();
        ensure_safe_vsix_entry_name(&name)?;
        if entry.is_dir() {
            continue;
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!("VSIX 包含符号链接: {name}"));
        }
        let uncompressed = entry.size();
        if uncompressed > MAX_VSIX_ENTRY_BYTES {
            return Err(format!("VSIX 文件超过大小上限: {name}"));
        }
        if name == "extension/package.json" || name == "package.json" {
            manifest_index = Some(index);
        }
    }
    let Some(manifest_index) = manifest_index else {
        return Err("VSIX 缺少 extension/package.json".to_string());
    };

    let mut buf = String::new();
    archive
        .by_index(manifest_index)
        .map_err(|error| format!("读取 VSIX package.json 失败: {error}"))?
        .read_to_string(&mut buf)
        .map_err(|error| format!("读取 VSIX package.json 失败: {error}"))?;
    let pkg: VsCodePackageJson = serde_json::from_str(&buf)
        .map_err(|error| format!("解析 VSIX package.json 失败: {error}"))?;

    // 第二遍：按 main 字段定位主入口 JS（默认 extension/extension.js）。
    let main_candidates: Vec<String> = match pkg.main.as_deref().map(str::trim) {
        Some(main) if !main.is_empty() => {
            let cleaned = main.trim_start_matches("./").trim_start_matches('/');
            let cleaned = cleaned.replace('\\', "/");
            let lower = cleaned.to_ascii_lowercase();
            let normalized = if lower.starts_with("extension/") {
                cleaned.clone()
            } else {
                format!("extension/{cleaned}")
            };
            vec![normalized, cleaned]
        }
        _ => vec!["extension/extension.js".to_string()],
    };
    let js_source = {
        let mut js = None;
        for candidate in &main_candidates {
            let wanted = |name: &str| name.eq_ignore_ascii_case(candidate);
            js = read_vsix_entry_bytes(&mut archive, &wanted, "主入口 JS")?;
            if js.is_some() {
                break;
            }
        }
        js.unwrap_or_default()
    };

    let id = if pkg.name.starts_with("vscode-") {
        pkg.name.clone()
    } else {
        format!("vscode-{}", pkg.name.to_lowercase().replace('_', "-"))
    };
    let display_title = pkg.display_name.clone().unwrap_or_else(|| pkg.name.clone());
    let mut disp_map = HashMap::new();
    disp_map.insert("zh-CN".to_string(), display_title.clone());
    disp_map.insert("en".to_string(), display_title.clone());

    let mut categories = pkg.categories.clone();
    if categories.is_empty() {
        categories.push("VS Code Compat".to_string());
    }

    let manifest = ExtensionManifest {
        package_version: 1,
        id,
        name: pkg.name,
        display_name: Some(disp_map.clone()),
        publisher: pkg
            .publisher
            .unwrap_or_else(|| "vscode-community".to_string()),
        version: pkg.version.unwrap_or_else(|| "1.0.0".to_string()),
        description: pkg.description.clone(),
        display_description: pkg.description.map(|d| {
            let mut m = HashMap::new();
            m.insert("zh-CN".to_string(), d.clone());
            m.insert("en".to_string(), d);
            m
        }),
        readme: None,
        changelog: None,
        engine: EngineRequirement {
            aurona_code: ">=0.4.0".to_string(),
        },
        runtime: RuntimeEntry {
            component: "extension.js".to_string(),
        },
        sidebar: SidebarEntry {
            title: display_title,
            display_title: Some(disp_map),
            icon: "assets/icon.svg".to_string(),
        },
        view: ViewEntry {
            entry: "ui/index.html".to_string(),
        },
        // .vsix 不预声明权限：JS 运行时按需通过 request-permission 触发
        // 三选一授权弹窗（声明 → 审查 → 授予 → 强制 流程的运行时分支）。
        permissions: Vec::new(),
        marketplace: Some(MarketplaceMetadata {
            categories,
            tags: pkg.keywords,
            author: None,
            homepage: pkg.homepage,
            repository: None,
            license: pkg.license,
            rating: Some(5.0),
            downloads: Some(0),
        }),
    };

    let icon_svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>"#.to_string();
    let view_html = r#"<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none';"></head><body><!--AURONA_RENDER_SLOT--></body></html>"#.to_string();

    Ok(Arc::new(ExtensionPackage {
        manifest,
        wasm: Vec::new(),
        view_html,
        icon_svg,
        js_source,
    }))
}

#[cfg(test)]
pub(crate) fn zip_store_for_tests(entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut buffer);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, data) in entries {
            writer.start_file(*name, options).expect("start file");
            writer.write_all(data).expect("write file");
        }
        writer.finish().expect("finish zip");
    }
    buffer.into_inner()
}

#[cfg(test)]
pub(crate) fn valid_manifest_for_tests() -> ExtensionManifest {
    ExtensionManifest {
        package_version: 1,
        id: "auronalabs.markdown".to_string(),
        name: "Markdown Preview".to_string(),
        display_name: None,
        publisher: "aurona".to_string(),
        version: "0.1.0".to_string(),
        description: None,
        display_description: None,
        readme: None,
        changelog: None,
        engine: EngineRequirement {
            aurona_code: ">=0.3.12".to_string(),
        },
        runtime: RuntimeEntry {
            component: "extension.wasm".to_string(),
        },
        sidebar: SidebarEntry {
            title: "Markdown".to_string(),
            display_title: None,
            icon: "assets/icon.svg".to_string(),
        },
        view: ViewEntry {
            entry: "ui/index.html".to_string(),
        },
        permissions: vec!["editor.current.read".to_string()],
        marketplace: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_manifest() -> ExtensionManifest {
        valid_manifest_for_tests()
    }

    #[test]
    fn manifest_id_allows_hyphen_segments() {
        // 回归：aurona.vscode-compat 因连字符被误拒，导致兼容层从未进入注册表
        let mut manifest = valid_manifest();
        manifest.id = "aurona.vscode-compat".to_string();
        assert!(validate_manifest(&manifest).is_ok());
        let mut underscore_denied = valid_manifest();
        underscore_denied.id = "aurona.vscode_compat".to_string();
        assert!(validate_manifest(&underscore_denied).is_err());
    }

    fn pack(entries: &[(&str, &[u8])]) -> Vec<u8> {
        zip_store_for_tests(entries)
    }

    fn valid_package_bytes() -> Vec<u8> {
        let manifest = serde_json::to_vec(&valid_manifest_for_tests()).unwrap();
        pack(&[
            ("manifest.json", &manifest),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html><body>view</body></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ])
    }

    /// Hand-crafted ZIP writer that intentionally permits duplicate entry
    /// names, which `zip::ZipWriter` refuses to produce.
    fn zip_store_raw(entries: &[(&str, &[u8])]) -> Vec<u8> {
        fn u16(value: u16) -> [u8; 2] {
            value.to_le_bytes()
        }
        fn u32(value: u32) -> [u8; 4] {
            value.to_le_bytes()
        }

        let mut output = Vec::new();
        let mut central = Vec::new();
        let mut offset = 0u32;

        for (name, data) in entries {
            let name_bytes = name.as_bytes();
            let crc = crc32fast::hash(data);
            output.extend_from_slice(&u32(0x0403_4b50));
            output.extend_from_slice(&u16(20));
            output.extend_from_slice(&u16(0x0800));
            output.extend_from_slice(&u16(0));
            output.extend_from_slice(&u16(0));
            output.extend_from_slice(&u16(0));
            output.extend_from_slice(&u32(crc));
            output.extend_from_slice(&u32(data.len() as u32));
            output.extend_from_slice(&u32(data.len() as u32));
            output.extend_from_slice(&u16(name_bytes.len() as u16));
            output.extend_from_slice(&u16(0));
            output.extend_from_slice(name_bytes);
            output.extend_from_slice(data);

            central.extend_from_slice(&u32(0x0201_4b50));
            central.extend_from_slice(&u16(0x0314));
            central.extend_from_slice(&u16(20));
            central.extend_from_slice(&u16(0x0800));
            central.extend_from_slice(&u16(0));
            central.extend_from_slice(&u16(0));
            central.extend_from_slice(&u16(0));
            central.extend_from_slice(&u32(crc));
            central.extend_from_slice(&u32(data.len() as u32));
            central.extend_from_slice(&u32(data.len() as u32));
            central.extend_from_slice(&u16(name_bytes.len() as u16));
            central.extend_from_slice(&u16(0));
            central.extend_from_slice(&u16(0));
            central.extend_from_slice(&u16(0));
            central.extend_from_slice(&u16(0));
            central.extend_from_slice(&u32(0));
            central.extend_from_slice(&u32(offset));
            central.extend_from_slice(name_bytes);

            offset += 30 + name_bytes.len() as u32 + data.len() as u32;
        }

        let central_offset = output.len() as u32;
        output.extend_from_slice(&central);
        output.extend_from_slice(&u32(0x0605_4b50));
        output.extend_from_slice(&u16(0));
        output.extend_from_slice(&u16(0));
        output.extend_from_slice(&u16(entries.len() as u16));
        output.extend_from_slice(&u16(entries.len() as u16));
        output.extend_from_slice(&u32(central.len() as u32));
        output.extend_from_slice(&u32(central_offset));
        output.extend_from_slice(&u16(0));
        output
    }

    #[test]
    fn opens_valid_package() {
        let package = open_package(&valid_package_bytes()).unwrap();
        assert_eq!(package.id(), "auronalabs.markdown");
        assert_eq!(package.view_html, "<html><body>view</body></html>");
    }

    #[test]
    fn missing_manifest() {
        let bytes = pack(&[
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        assert!(open_package(&bytes).unwrap_err().contains("manifest"));
    }

    #[test]
    fn invalid_manifest_json() {
        let bytes = pack(&[
            ("manifest.json", b"{not json"),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        assert!(open_package(&bytes).unwrap_err().contains("无效"));
    }

    #[test]
    fn unsupported_package_version() {
        let mut manifest = valid_manifest();
        manifest.package_version = 2;
        let bytes = pack(&[
            (
                "manifest.json",
                serde_json::to_vec(&manifest).unwrap().as_slice(),
            ),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        assert!(open_package(&bytes).unwrap_err().contains("packageVersion"));
    }

    #[test]
    fn missing_wasm() {
        let manifest = serde_json::to_vec(&valid_manifest()).unwrap();
        let bytes = pack(&[
            ("manifest.json", manifest.as_slice()),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        assert!(open_package(&bytes).unwrap_err().contains("extension.wasm"));
    }

    #[test]
    fn invalid_wasm_magic() {
        let manifest = serde_json::to_vec(&valid_manifest()).unwrap();
        let bytes = pack(&[
            ("manifest.json", manifest.as_slice()),
            ("extension.wasm", b"not wasm"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        assert!(open_package(&bytes).unwrap_err().contains("WebAssembly"));
    }

    #[test]
    fn rejects_duplicate_entries() {
        let manifest = serde_json::to_vec(&valid_manifest()).unwrap();
        let bytes = zip_store_raw(&[
            ("manifest.json", manifest.as_slice()),
            ("manifest.json", b"{}"),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        let error = open_package(&bytes).unwrap_err();
        assert!(error.contains("重复"), "{error}");
    }

    #[test]
    fn rejects_parent_traversal() {
        let manifest = serde_json::to_vec(&valid_manifest()).unwrap();
        let bytes = pack(&[
            ("manifest.json", manifest.as_slice()),
            ("../evil", b"x"),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        assert!(open_package(&bytes).unwrap_err().contains("不安全"));
    }

    #[test]
    fn rejects_absolute_and_unc() {
        for evil in ["/etc/passwd", "C:/Windows/win.ini", "//server/share"] {
            let manifest = serde_json::to_vec(&valid_manifest()).unwrap();
            let bytes = pack(&[
                ("manifest.json", manifest.as_slice()),
                (evil, b"x"),
                ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
                ("ui/index.html", b"<html></html>"),
                ("assets/icon.svg", b"<svg></svg>"),
            ]);
            assert!(open_package(&bytes).is_err(), "should reject {evil}");
        }
    }

    #[test]
    fn rejects_unknown_files() {
        let manifest = serde_json::to_vec(&valid_manifest()).unwrap();
        let bytes = pack(&[
            ("manifest.json", manifest.as_slice()),
            ("extra.txt", b"x"),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        assert!(open_package(&bytes).unwrap_err().contains("未知文件"));
    }

    #[test]
    fn rejects_oversized_entry() {
        let manifest = serde_json::to_vec(&valid_manifest()).unwrap();
        let huge = vec![0u8; (MAX_WASM_BYTES + 1) as usize];
        let bytes = pack(&[
            ("manifest.json", manifest.as_slice()),
            ("extension.wasm", huge.as_slice()),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        assert!(open_package(&bytes).unwrap_err().contains("大小上限"));
    }

    #[test]
    fn rejects_corrupt_archive() {
        let mut bytes = valid_package_bytes();
        let wasm_magic = bytes
            .windows(4)
            .position(|window| window == b"\0asm")
            .expect("wasm magic present");
        bytes[wasm_magic + 4] ^= 0xff;
        let result = open_package(&bytes);
        assert!(result.is_err());
    }

    #[test]
    fn parses_marketplace_metadata() {
        let mut manifest = valid_manifest();
        manifest.marketplace = Some(MarketplaceMetadata {
            categories: vec!["Tools".to_string()],
            tags: vec!["editor".to_string()],
            author: Some("Aurona".to_string()),
            homepage: Some("https://aurona.dev".to_string()),
            repository: None,
            license: Some("MIT".to_string()),
            rating: Some(4.9),
            downloads: Some(1024),
        });

        let json = serde_json::to_string(&manifest).expect("serialize");
        let parsed: ExtensionManifest = serde_json::from_str(&json).expect("deserialize");
        assert!(parsed.marketplace.is_some());
        let m = parsed.marketplace.unwrap();
        assert_eq!(m.categories, vec!["Tools"]);
        assert_eq!(m.author.as_deref(), Some("Aurona"));
        assert_eq!(m.downloads, Some(1024));
    }

    #[test]
    fn accepts_declaring_available_permissions() {
        let mut manifest = valid_manifest();
        manifest.permissions = vec![
            "editor.current.read".to_string(),
            "workspace.read".to_string(),
            "workspace.write".to_string(),
        ];
        let json = serde_json::to_vec(&manifest).unwrap();
        let bytes = pack(&[
            ("manifest.json", json.as_slice()),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        assert!(open_package(&bytes).is_ok());
    }

    #[test]
    fn rejects_declaring_unknown_permissions() {
        let mut manifest = valid_manifest();
        manifest.permissions = vec!["made.up".to_string()];
        let json = serde_json::to_vec(&manifest).unwrap();
        let bytes = pack(&[
            ("manifest.json", json.as_slice()),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        let error = open_package(&bytes).unwrap_err();
        assert!(error.contains("未知权限"), "{error}");
    }

    #[test]
    fn rejects_declaring_unavailable_permissions() {
        // terminal.execute 已登记但当前版本未开放：应在安装期就被拦下，
        // 而不是装上后永远拿不到
        let mut manifest = valid_manifest();
        manifest.permissions = vec!["terminal.execute".to_string()];
        let json = serde_json::to_vec(&manifest).unwrap();
        let bytes = pack(&[
            ("manifest.json", json.as_slice()),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        let error = open_package(&bytes).unwrap_err();
        assert!(error.contains("尚未开放"), "{error}");
    }

    #[test]
    fn loads_legacy_manifest_without_permissions_field() {
        // 旧包没有 permissions 字段，必须能继续加载（向后兼容）
        let manifest = r#"{
            "packageVersion": 1,
            "id": "auronalabs.legacy",
            "name": "Legacy",
            "publisher": "aurona",
            "version": "1.0.0",
            "engine": { "auronaCode": ">=0.4.0" },
            "runtime": { "component": "extension.wasm" },
            "sidebar": { "title": "Legacy", "icon": "assets/icon.svg" },
            "view": { "entry": "ui/index.html" }
        }"#;
        let bytes = pack(&[
            ("manifest.json", manifest.as_bytes()),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        let package = open_package(&bytes).expect("legacy package should load");
        assert!(package.manifest.permissions.is_empty());
    }
}
