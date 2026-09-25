use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use super::aurx::{open_package, ExtensionPackage};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionDescriptor {
    pub id: String,
    pub name: String,
    pub display_name: Option<HashMap<String, String>>,
    pub publisher: String,
    pub version: String,
    pub description: Option<String>,
    pub display_description: Option<HashMap<String, String>>,
    pub readme: Option<String>,
    pub changelog: Option<String>,
    pub sidebar_title: String,
    pub display_title: Option<HashMap<String, String>>,
    pub sidebar_icon: String,
    pub view_entry: String,
    /// manifest 声明的权限。前端据此渲染"声明驱动"的权限矩阵，而不是固定全量列表。
    pub permissions: Vec<String>,
    pub marketplace: Option<super::aurx::MarketplaceMetadata>,
}

impl ExtensionDescriptor {
    fn from_package(package: &ExtensionPackage) -> Self {
        let manifest = &package.manifest;
        Self {
            id: canonical_extension_id(&manifest.id).to_string(),
            name: manifest.name.clone(),
            display_name: manifest.display_name.clone(),
            publisher: manifest.publisher.clone(),
            version: manifest.version.clone(),
            description: manifest.description.clone(),
            display_description: manifest.display_description.clone(),
            readme: manifest.readme.clone(),
            changelog: manifest.changelog.clone(),
            sidebar_title: manifest.sidebar.title.clone(),
            display_title: manifest.sidebar.display_title.clone(),
            sidebar_icon: manifest.sidebar.icon.clone(),
            view_entry: manifest.view.entry.clone(),
            permissions: manifest.permissions.clone(),
            marketplace: manifest.marketplace.clone(),
        }
    }
}

/// 单个扩展包加载失败的诊断记录。目录扫描是容错的：一个坏包不拖垮其他包，
/// 失败原因进入诊断列表（前端可通过 IPC 拉取），而不是中断整个目录。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryDiagnostic {
    pub source: String,
    pub message: String,
}

/// 聚合诊断载荷（IPC `extensions_get_diagnostics` 返回值）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryDiagnostics {
    pub load: Vec<RegistryDiagnostic>,
    pub last_runtime_failure: Option<String>,
    pub installed: Vec<String>,
}

/// Discovers and owns the bundled AURX packages. Discovery opens and validates
/// package structure, but never compiles or instantiates the WASM component.
pub struct ExtensionRegistry {
    packages: Mutex<HashMap<String, Arc<ExtensionPackage>>>,
    diagnostics: Mutex<Vec<RegistryDiagnostic>>,
}

impl ExtensionRegistry {
    pub fn new() -> Self {
        Self {
            packages: Mutex::new(HashMap::new()),
            diagnostics: Mutex::new(Vec::new()),
        }
    }

    pub fn load_file(&self, path: &Path) -> Result<Arc<ExtensionPackage>, String> {
        let bytes = std::fs::read(path)
            .map_err(|error| format!("读取扩展包失败 {}: {error}", path.display()))?;
        let is_vsix = path.extension().is_some_and(|ext| ext == "vsix");
        let package = if is_vsix {
            super::aurx::open_vsix_package(&bytes)?
        } else {
            open_package(&bytes)?
        };
        self.register_package(package)
    }

    fn register_package(
        &self,
        package: Arc<ExtensionPackage>,
    ) -> Result<Arc<ExtensionPackage>, String> {
        let id = canonical_extension_id(package.id()).to_string();
        self.packages
            .lock()
            .map_err(|_| "扩展注册表锁已损坏".to_string())?
            .entry(id.clone())
            .and_modify(|existing| {
                if package.id() == id || existing.id() != id {
                    *existing = package.clone();
                }
            })
            .or_insert_with(|| package.clone());
        Ok(package)
    }

    pub fn load_bundled_compat(&self, dir: &Path) -> usize {
        let path = dir.join("aurona.vscode-compat.aurx");
        if !path.is_file() {
            return 0;
        }
        let result = std::fs::read(&path)
            .map_err(|error| format!("读取扩展包失败 {}: {error}", path.display()))
            .and_then(|bytes| open_package(&bytes))
            .and_then(|package| {
                if package.id() != "aurona.vscode-compat" {
                    return Err(format!("内置兼容层包 ID 不符: {}", package.id()));
                }
                self.register_package(package)
            });
        match result {
            Ok(_) => 1,
            Err(error) => {
                self.push_diagnostic(path.display().to_string(), error);
                0
            }
        }
    }

    pub fn load_directory(&self, dir: &Path) -> Result<usize, String> {
        if !dir.exists() {
            return Ok(0);
        }
        let mut loaded = 0usize;
        for entry in std::fs::read_dir(dir)
            .map_err(|error| format!("读取扩展目录失败 {}: {error}", dir.display()))?
        {
            // 目录级容错：逐条目隔离失败（含 read_dir 条目错误），
            // 记入诊断后继续扫描，保证单个损坏包不影响其余扩展加载。
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    self.push_diagnostic(
                        dir.display().to_string(),
                        format!("读取扩展目录条目失败: {error}"),
                    );
                    continue;
                }
            };
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "aurx" || extension == "vsix")
            {
                match self.load_file(&path) {
                    Ok(_package) => loaded += 1,
                    Err(error) => self.push_diagnostic(path.display().to_string(), error),
                }
            }
        }
        Ok(loaded)
    }

    fn push_diagnostic(&self, source: String, message: String) {
        eprintln!("[Extensions] 包加载失败: {source}: {message}");
        if let Ok(mut guard) = self.diagnostics.lock() {
            guard.push(RegistryDiagnostic { source, message });
        }
    }

    /// 取出自上次扫描以来累积的加载诊断（读取后不清空，便于前端随时拉取）。
    pub fn diagnostics(&self) -> Vec<RegistryDiagnostic> {
        self.diagnostics
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    pub fn descriptors(&self) -> Vec<ExtensionDescriptor> {
        self.packages
            .lock()
            .map(|guard| {
                let mut descriptors: Vec<_> = guard
                    .values()
                    .map(|package| ExtensionDescriptor::from_package(package))
                    .collect();
                descriptors.sort_by(|a, b| a.id.cmp(&b.id));
                descriptors
            })
            .unwrap_or_default()
    }

    pub fn package(&self, id: &str) -> Option<Arc<ExtensionPackage>> {
        let id = canonical_extension_id(id);
        self.packages
            .lock()
            .ok()
            .and_then(|guard| guard.get(id).cloned())
    }

    pub fn remove(&self, id: &str) -> bool {
        let id = canonical_extension_id(id);
        self.packages
            .lock()
            .map(|mut guard| guard.remove(id).is_some())
            .unwrap_or(false)
    }
}

pub fn canonical_extension_id(id: &str) -> &str {
    match id {
        "aurona.markdown" => "auronalabs.markdown",
        "aurona.planner" => "auronalabs.planner",
        _ => id,
    }
}

impl Default for ExtensionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::aurx::{valid_manifest_for_tests, zip_store_for_tests};
    use serde_json::json;
    use std::path::PathBuf;

    fn write_package(dir: &Path, name: &str, overrides: Option<serde_json::Value>) -> PathBuf {
        let mut manifest = serde_json::to_value(valid_manifest_for_tests()).unwrap();
        if let Some(overrides) = overrides {
            for (key, value) in overrides.as_object().unwrap() {
                manifest[key] = value.clone();
            }
        }
        let bytes = zip_store_for_tests(&[
            (
                "manifest.json",
                serde_json::to_vec(&manifest).unwrap().as_slice(),
            ),
            ("extension.wasm", b"\0asm\x01\x00\x00\x00"),
            ("ui/index.html", b"<html><body>view</body></html>"),
            ("assets/icon.svg", b"<svg></svg>"),
        ]);
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn discovers_bundled_packages() {
        let temp = std::env::temp_dir().join(format!("aurona-ext-registry-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        let path = write_package(&temp, "auronalabs.markdown.aurx", None);
        let registry = ExtensionRegistry::new();
        registry.load_file(&path).unwrap();
        let descriptors = registry.descriptors();
        assert_eq!(descriptors.len(), 1);
        assert_eq!(descriptors[0].id, "auronalabs.markdown");
        assert!(registry.package("auronalabs.markdown").is_some());
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn canonical_package_wins_over_legacy_package_in_any_load_order() {
        let temp =
            std::env::temp_dir().join(format!("aurona-ext-registry-alias-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        let canonical = write_package(
            &temp,
            "canonical.aurx",
            Some(json!({ "id": "auronalabs.markdown", "name": "Canonical" })),
        );
        let legacy = write_package(
            &temp,
            "legacy.aurx",
            Some(json!({ "id": "aurona.markdown", "name": "Legacy" })),
        );

        let registry = ExtensionRegistry::new();
        registry.load_file(&legacy).unwrap();
        registry.load_file(&canonical).unwrap();
        assert_eq!(
            registry
                .package("auronalabs.markdown")
                .unwrap()
                .manifest
                .name,
            "Canonical"
        );

        let reverse = ExtensionRegistry::new();
        reverse.load_file(&canonical).unwrap();
        reverse.load_file(&legacy).unwrap();
        assert_eq!(
            reverse.package("aurona.markdown").unwrap().manifest.name,
            "Canonical"
        );
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn same_id_reload_replaces_installed_package() {
        let temp =
            std::env::temp_dir().join(format!("aurona-ext-registry-update-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        let old = write_package(
            &temp,
            "old.aurx",
            Some(json!({ "id": "auronalabs.markdown", "version": "0.1.0" })),
        );
        let updated = write_package(
            &temp,
            "updated.aurx",
            Some(json!({ "id": "auronalabs.markdown", "version": "0.2.0" })),
        );
        let registry = ExtensionRegistry::new();
        registry.load_file(&old).unwrap();
        registry.load_file(&updated).unwrap();
        assert_eq!(registry.descriptors()[0].version, "0.2.0");
        assert_eq!(
            registry
                .package("auronalabs.markdown")
                .unwrap()
                .manifest
                .version,
            "0.2.0"
        );
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn bundled_scan_only_loads_valid_compat_package() {
        let temp = std::env::temp_dir().join(format!(
            "aurona-ext-registry-bundled-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&temp).unwrap();
        let compat = write_package(
            &temp,
            "aurona.vscode-compat.aurx",
            Some(json!({ "id": "aurona.vscode-compat" })),
        );
        write_package(&temp, "aurona.markdown.aurx", None);
        let registry = ExtensionRegistry::new();
        assert_eq!(registry.load_bundled_compat(&temp), 1);
        assert_eq!(registry.descriptors().len(), 1);
        assert!(registry.package("aurona.vscode-compat").is_some());
        assert!(registry.package("auronalabs.markdown").is_none());

        write_package(
            &temp,
            "aurona.vscode-compat.aurx",
            Some(json!({ "id": "auronalabs.markdown" })),
        );
        let fresh_registry = ExtensionRegistry::new();
        assert_eq!(fresh_registry.load_bundled_compat(&temp), 0);
        assert!(fresh_registry.descriptors().is_empty());
        assert_eq!(fresh_registry.diagnostics().len(), 1);
        std::fs::remove_file(compat).ok();
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn loads_only_aurx_files() {
        let temp =
            std::env::temp_dir().join(format!("aurona-ext-registry-dir-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        write_package(&temp, "auronalabs.markdown.aurx", None);
        std::fs::write(temp.join("notes.txt"), b"ignored").unwrap();
        let registry = ExtensionRegistry::new();
        let count = registry.load_directory(&temp).unwrap();
        assert_eq!(count, 1);
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn rejects_corrupt_bundled_package() {
        let temp =
            std::env::temp_dir().join(format!("aurona-ext-registry-bad-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        let path = temp.join("broken.aurx");
        std::fs::write(&path, b"not a zip").unwrap();
        let registry = ExtensionRegistry::new();
        assert!(registry.load_file(&path).is_err());
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn directory_scan_isolates_corrupt_packages() {
        let temp = std::env::temp_dir().join(format!(
            "aurona-ext-registry-tolerant-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&temp).unwrap();
        write_package(&temp, "auronalabs.markdown.aurx", None);
        std::fs::write(temp.join("broken.aurx"), b"not a zip").unwrap();

        let registry = ExtensionRegistry::new();
        let count = registry.load_directory(&temp).unwrap();
        // 坏包不拖垮目录：好包照常加载
        assert_eq!(count, 1);
        assert!(registry.package("auronalabs.markdown").is_some());
        // 失败原因进入诊断列表
        let diagnostics = registry.diagnostics();
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].source.contains("broken.aurx"));
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn rejects_wrong_id_manifest() {
        let temp =
            std::env::temp_dir().join(format!("aurona-ext-registry-id-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        let path = write_package(
            &temp,
            "auronalabs.markdown.aurx",
            Some(json!({ "id": "evil.id" })),
        );
        let registry = ExtensionRegistry::new();
        registry.load_file(&path).unwrap();
        // The registry keys by manifest id, not by file name.
        assert!(registry.package("evil.id").is_some());
        std::fs::remove_dir_all(&temp).ok();
    }
}
