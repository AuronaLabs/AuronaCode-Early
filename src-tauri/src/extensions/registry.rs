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
    pub sidebar_title: String,
    pub display_title: Option<HashMap<String, String>>,
    pub sidebar_icon: String,
    pub view_entry: String,
    pub marketplace: Option<super::aurx::MarketplaceMetadata>,
}

impl ExtensionDescriptor {
    fn from_package(package: &ExtensionPackage) -> Self {
        let manifest = &package.manifest;
        Self {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            display_name: manifest.display_name.clone(),
            publisher: manifest.publisher.clone(),
            version: manifest.version.clone(),
            description: manifest.description.clone(),
            display_description: manifest.display_description.clone(),
            sidebar_title: manifest.sidebar.title.clone(),
            display_title: manifest.sidebar.display_title.clone(),
            sidebar_icon: manifest.sidebar.icon.clone(),
            view_entry: manifest.view.entry.clone(),
            marketplace: manifest.marketplace.clone(),
        }
    }
}

/// Discovers and owns the bundled AURX packages. Discovery opens and validates
/// package structure, but never compiles or instantiates the WASM component.
pub struct ExtensionRegistry {
    packages: Mutex<HashMap<String, Arc<ExtensionPackage>>>,
}

impl ExtensionRegistry {
    pub fn new() -> Self {
        Self {
            packages: Mutex::new(HashMap::new()),
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
        let id = package.id().to_string();
        self.packages
            .lock()
            .map_err(|_| "扩展注册表锁已损坏".to_string())?
            .insert(id.clone(), package.clone());
        Ok(package)
    }

    pub fn load_directory(&self, dir: &Path) -> Result<usize, String> {
        if !dir.exists() {
            return Ok(0);
        }
        let mut loaded = 0usize;
        for entry in std::fs::read_dir(dir)
            .map_err(|error| format!("读取扩展目录失败 {}: {error}", dir.display()))?
        {
            let entry = entry.map_err(|error| format!("读取扩展目录条目失败: {error}"))?;
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "aurx" || extension == "vsix")
            {
                let package = self.load_file(&path)?;
                if is_removed_legacy_extension(package.id()) {
                    self.remove(package.id());
                } else {
                    loaded += 1;
                }
            }
        }
        Ok(loaded)
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
        self.packages
            .lock()
            .ok()
            .and_then(|guard| guard.get(id).cloned())
    }

    pub fn remove(&self, id: &str) -> bool {
        self.packages
            .lock()
            .map(|mut guard| guard.remove(id).is_some())
            .unwrap_or(false)
    }
}

fn is_removed_legacy_extension(id: &str) -> bool {
    matches!(id, "aurona.markdown" | "aurona.planner")
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
