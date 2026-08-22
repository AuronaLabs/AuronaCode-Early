use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use super::aurx::ExtensionPackage;
use super::registry::ExtensionRegistry;
use super::runtime::{ContextPermissionState, ExtensionLimits, ExtensionRuntime};

const PERMISSIONS_FILE: &str = "extensions-permissions.json";

pub struct ExtensionState {
    registry: ExtensionRegistry,
    runtimes: Mutex<HashMap<String, Arc<ExtensionRuntime>>>,
    permissions: Mutex<HashMap<String, ContextPermissionState>>,
    session_permissions: Mutex<HashSet<String>>,
    config_dir: Mutex<Option<PathBuf>>,
}

impl ExtensionState {
    pub fn new() -> Self {
        Self {
            registry: ExtensionRegistry::new(),
            runtimes: Mutex::new(HashMap::new()),
            permissions: Mutex::new(HashMap::new()),
            session_permissions: Mutex::new(HashSet::new()),
            config_dir: Mutex::new(None),
        }
    }

    /// Discovers bundled AURX packages and loads persisted permissions.
    pub fn initialize(&self, app: &AppHandle) -> Result<usize, String> {
        let loaded = self.scan_extensions(app);
        let config_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("无法定位数据目录: {error}"))?;
        self.load_permissions(&config_dir);
        *self
            .config_dir
            .lock()
            .map_err(|_| "扩展状态锁已损坏".to_string())? = Some(config_dir);
        Ok(loaded)
    }

    /// 扫描并汇聚所有候选路径下的 .aurx 扩展包（优先源码资源目录）
    pub fn scan_extensions(&self, app: &AppHandle) -> usize {
        let mut candidate_roots = Vec::new();
        // 1. 源码工程目录优先（开发与热更新支持）
        candidate_roots.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("extensions"),
        );
        // 2. 打包后的资源目录
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidate_roots.push(resource_dir.join("extensions"));
            candidate_roots.push(resource_dir.join("resources").join("extensions"));
        }
        if let Ok(local_data_dir) = app.path().app_local_data_dir() {
            candidate_roots.push(local_data_dir.join("extensions"));
        }

        let mut loaded = 0usize;
        for dir in candidate_roots {
            if dir.is_dir() {
                if let Ok(count) = self.registry.load_directory(&dir) {
                    loaded += count;
                }
            }
        }
        loaded
    }

    pub fn descriptors(&self) -> Vec<super::registry::ExtensionDescriptor> {
        self.registry.descriptors()
    }

    pub fn package(&self, id: &str) -> Option<Arc<ExtensionPackage>> {
        self.registry.package(id)
    }

    pub fn install_package(
        &self,
        app: &AppHandle,
        archive_bytes: &[u8],
    ) -> Result<super::registry::ExtensionDescriptor, String> {
        let package = super::aurx::open_package(archive_bytes)?;
        let id = package.id().to_string();
        if is_builtin_extension(&id) {
            return Err(format!("内置扩展不能覆盖安装: {id}"));
        }
        let extension_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("无法定位扩展目录: {error}"))?
            .join("extensions");
        std::fs::create_dir_all(&extension_dir)
            .map_err(|error| format!("无法创建扩展目录: {error}"))?;
        let target = extension_dir.join(format!("{id}.aurx"));
        std::fs::write(&target, archive_bytes)
            .map_err(|error| format!("无法保存扩展安装包: {error}"))?;
        self.registry.load_file(&target)?;
        self.runtimes
            .lock()
            .map_err(|_| "扩展运行时状态锁定失败".to_string())?
            .remove(&id);
        self.descriptors()
            .into_iter()
            .find(|descriptor| descriptor.id == id)
            .ok_or_else(|| format!("扩展安装后未能注册: {id}"))
    }

    pub fn uninstall_package(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        if is_builtin_extension(id) {
            return Err(format!("内置扩展不能卸载: {id}"));
        }
        let extension_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("无法定位扩展目录: {error}"))?
            .join("extensions");
        let target = extension_dir.join(format!("{id}.aurx"));
        if !target.exists() {
            return Err(format!("未找到已安装扩展: {id}"));
        }
        std::fs::remove_file(&target).map_err(|error| format!("无法卸载扩展安装包: {error}"))?;
        self.runtimes
            .lock()
            .map_err(|_| "扩展运行时状态锁定失败".to_string())?
            .remove(id);
        self.registry.remove(id);
        Ok(())
    }

    pub fn runtime_for(&self, id: &str) -> Result<Arc<ExtensionRuntime>, String> {
        if let Some(runtime) = self
            .runtimes
            .lock()
            .map_err(|_| "扩展运行时锁已损坏".to_string())?
            .get(id)
            .cloned()
        {
            return Ok(runtime);
        }
        let package = self
            .package(id)
            .ok_or_else(|| format!("扩展不存在: {id}"))?;
        let wasm_bytes = if package.wasm.is_empty() {
            if let Some(compat_pkg) = self.package("aurona.vscode-compat") {
                compat_pkg.wasm.clone()
            } else {
                package.wasm.clone()
            }
        } else {
            package.wasm.clone()
        };
        let runtime = Arc::new(ExtensionRuntime::new(
            &wasm_bytes,
            ExtensionLimits::default(),
        )?);
        self.runtimes
            .lock()
            .map_err(|_| "扩展运行时锁已损坏".to_string())?
            .insert(id.to_string(), runtime.clone());
        Ok(runtime)
    }

    pub fn permission(
        &self,
        extension_id: &str,
        permission: &str,
        workspace_identity: &str,
    ) -> ContextPermissionState {
        let key = permission_key(extension_id, permission, workspace_identity);
        if let Some(state) = self
            .permissions
            .lock()
            .ok()
            .and_then(|guard| guard.get(&key).cloned())
        {
            return state;
        }
        let session_granted = self
            .session_permissions
            .lock()
            .map(|guard| guard.contains(&key))
            .unwrap_or(false);
        if session_granted {
            return ContextPermissionState::Granted;
        }
        if is_builtin_extension(extension_id) && permission == "editor.current.read" {
            return ContextPermissionState::Granted;
        }
        ContextPermissionState::Unknown
    }

    pub fn set_permission(
        &self,
        extension_id: &str,
        permission: &str,
        workspace_identity: &str,
        granted: bool,
    ) -> ContextPermissionState {
        let key = permission_key(extension_id, permission, workspace_identity);
        let state = if granted {
            ContextPermissionState::Granted
        } else {
            ContextPermissionState::Denied
        };
        if let Ok(mut guard) = self.permissions.lock() {
            guard.insert(key, state);
        }
        self.persist_permissions();
        state
    }

    /// Grants a permission only for the current Aurona Code process. The grant
    /// is intentionally excluded from the persisted permission file.
    pub fn set_session_permission(
        &self,
        extension_id: &str,
        permission: &str,
        workspace_identity: &str,
        granted: bool,
    ) -> ContextPermissionState {
        let key = permission_key(extension_id, permission, workspace_identity);
        if let Ok(mut guard) = self.session_permissions.lock() {
            if granted {
                guard.insert(key);
            } else {
                guard.remove(&key);
            }
        }
        if granted {
            ContextPermissionState::Granted
        } else {
            ContextPermissionState::Denied
        }
    }

    fn load_permissions(&self, config_dir: &std::path::Path) {
        let path = config_dir.join(PERMISSIONS_FILE);
        let Ok(content) = std::fs::read_to_string(path) else {
            return;
        };
        let Ok(values) = serde_json::from_str::<HashMap<String, String>>(&content) else {
            return;
        };
        if let Ok(mut guard) = self.permissions.lock() {
            for (key, value) in values {
                let state = match value.as_str() {
                    "granted" => ContextPermissionState::Granted,
                    "denied" => ContextPermissionState::Denied,
                    _ => continue,
                };
                guard.insert(key, state);
            }
        }
    }

    fn persist_permissions(&self) {
        let Some(config_dir) = self.config_dir.lock().ok().and_then(|guard| guard.clone()) else {
            return;
        };
        let values: HashMap<String, String> = self
            .permissions
            .lock()
            .map(|guard| {
                guard
                    .iter()
                    .map(|(key, state)| {
                        let value = match state {
                            ContextPermissionState::Granted => "granted",
                            ContextPermissionState::Denied => "denied",
                            ContextPermissionState::Unknown => "unknown",
                        };
                        (key.clone(), value.to_string())
                    })
                    .collect()
            })
            .unwrap_or_default();
        let path = config_dir.join(PERMISSIONS_FILE);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(
            &path,
            serde_json::to_vec_pretty(&values).unwrap_or_default(),
        );
    }
}

fn is_builtin_extension(extension_id: &str) -> bool {
    matches!(extension_id, "aurona.vscode-compat" | "vscode-demo")
}

impl Default for ExtensionState {
    fn default() -> Self {
        Self::new()
    }
}

fn permission_key(extension_id: &str, permission: &str, workspace_identity: &str) -> String {
    format!("{extension_id}:{permission}:{workspace_identity}")
}

pub fn workspace_identity(root: Option<&std::path::Path>) -> String {
    root.and_then(|path| path.canonicalize().ok())
        .map(|path| path.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "none".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permissions_are_scoped_by_workspace() {
        let state = ExtensionState::new();
        // 官方内置扩展默认获得 editor.current.read 权限
        assert_eq!(
            state.permission("aurona.vscode-compat", "editor.current.read", "ws-a"),
            ContextPermissionState::Granted
        );
        // 未知权限或非内置扩展默认保持 Unknown
        assert_eq!(
            state.permission("custom.extension", "editor.current.read", "ws-a"),
            ContextPermissionState::Unknown
        );

        state.set_permission("custom.extension", "editor.current.read", "ws-a", true);
        assert_eq!(
            state.permission("custom.extension", "editor.current.read", "ws-a"),
            ContextPermissionState::Granted
        );
        assert_eq!(
            state.permission("custom.extension", "editor.current.read", "ws-b"),
            ContextPermissionState::Unknown
        );

        state.set_permission("aurona.vscode-compat", "editor.current.read", "ws-a", false);
        assert_eq!(
            state.permission("aurona.vscode-compat", "editor.current.read", "ws-a"),
            ContextPermissionState::Denied
        );
    }

    #[test]
    fn workspace_read_permission_is_independent() {
        let state = ExtensionState::new();
        assert_eq!(
            state.permission("aurona.vscode-compat", "workspace.read", "ws-a"),
            ContextPermissionState::Unknown
        );
        state.set_permission("aurona.vscode-compat", "workspace.read", "ws-a", true);
        assert_eq!(
            state.permission("aurona.vscode-compat", "workspace.read", "ws-a"),
            ContextPermissionState::Granted
        );
    }

    #[test]
    fn workspace_identity_uses_canonical_root() {
        let temp = std::env::temp_dir().join(format!("aurona-ext-identity-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        let identity = workspace_identity(Some(&temp));
        assert!(!identity.is_empty());
        assert_ne!(identity, "none");
        assert_eq!(identity, identity.to_lowercase());
        std::fs::remove_dir_all(&temp).ok();
    }
}
