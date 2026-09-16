use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use super::aurx::ExtensionPackage;
use super::permissions::PermissionScope;
use super::registry::{canonical_extension_id, ExtensionRegistry};
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
        let config_dir_for_state = config_dir.clone();
        *self
            .config_dir
            .lock()
            .map_err(|_| "扩展状态锁已损坏".to_string())? = Some(config_dir);
        if self.load_permissions(&config_dir_for_state) {
            self.persist_permissions();
        }
        Ok(loaded)
    }

    /// 扫描并汇聚所有候选路径下的 .aurx 扩展包（优先源码资源目录）
    pub fn scan_extensions(&self, app: &AppHandle) -> usize {
        let mut candidate_roots = Vec::new();
        // 1. 源码工程目录：仅开发构建使用，便于改完即生效。
        //    发布构建里 CARGO_MANIFEST_DIR 是编译机的路径，在用户机器上无意义；
        //    更糟的是若该路径恰好存在，会把用户磁盘上的仓库当成扩展来源。
        #[cfg(debug_assertions)]
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
        expected_sha256: Option<&str>,
    ) -> Result<super::registry::ExtensionDescriptor, String> {
        if let Some(expected) = expected_sha256 {
            let expected_clean = expected.trim();
            if !expected_clean.is_empty() {
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(archive_bytes);
                let actual = format!("{:x}", hasher.finalize());
                if !actual.eq_ignore_ascii_case(expected_clean) {
                    return Err(format!(
                        "扩展包 SHA-256 安全校验失败: 期望 [{expected_clean}], 实际 [{actual}]"
                    ));
                }
            }
        }
        let package = super::aurx::open_package(archive_bytes)?;
        let id = canonical_extension_id(package.id()).to_string();
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
        // 升级语义：已授予的权限保留；新声明的权限无记录（= unknown，首次使用重新询问）；
        // 新版本**不再声明**的权限，其历史决定（granted/denied）立即清除（fail-closed）。
        self.reconcile_permissions_on_upgrade(&id, &package.manifest.permissions);
        self.descriptors()
            .into_iter()
            .find(|descriptor| descriptor.id == id)
            .ok_or_else(|| format!("扩展安装后未能注册: {id}"))
    }

    /// 安装本地 .vsix（VSCode 兼容路径 2，规划 §5.5）。
    /// 与 AURX 的差异：解析器走 `open_vsix_package`，落盘文件扩展名为 `.vsix`。
    pub fn install_vsix_package(
        &self,
        app: &AppHandle,
        vsix_bytes: &[u8],
    ) -> Result<super::registry::ExtensionDescriptor, String> {
        let package = super::aurx::open_vsix_package(vsix_bytes)?;
        let id = canonical_extension_id(package.id()).to_string();
        if is_builtin_extension(&id) {
            return Err(format!("内置扩展不能覆盖安装: {id}"));
        }
        if package.js_source.trim().is_empty() {
            return Err("VSIX 缺少可执行的主入口 JS，无法安装为兼容扩展".to_string());
        }
        let extension_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("无法定位扩展目录: {error}"))?
            .join("extensions");
        std::fs::create_dir_all(&extension_dir)
            .map_err(|error| format!("无法创建扩展目录: {error}"))?;
        let target = extension_dir.join(format!("{id}.vsix"));
        std::fs::write(&target, vsix_bytes)
            .map_err(|error| format!("无法保存扩展安装包: {error}"))?;
        self.registry.load_file(&target)?;
        self.runtimes
            .lock()
            .map_err(|_| "扩展运行时状态锁定失败".to_string())?
            .remove(&id);
        self.reconcile_permissions_on_upgrade(&id, &package.manifest.permissions);
        self.descriptors()
            .into_iter()
            .find(|descriptor| descriptor.id == id)
            .ok_or_else(|| format!("扩展安装后未能注册: {id}"))
    }

    pub fn uninstall_package(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        let id = canonical_extension_id(id);
        if is_builtin_extension(id) {
            return Err(format!("内置扩展不能卸载: {id}"));
        }
        let extension_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("无法定位扩展目录: {error}"))?
            .join("extensions");
        // 兼容两种落盘格式：AURX 包（市场扩展）与 VSIX（VSCode 兼容扩展）
        let target_aurx = extension_dir.join(format!("{id}.aurx"));
        let target_vsix = extension_dir.join(format!("{id}.vsix"));
        let target = if target_aurx.exists() {
            target_aurx
        } else if target_vsix.exists() {
            target_vsix
        } else {
            return Err(format!("未找到已安装扩展: {id}"));
        };
        std::fs::remove_file(&target).map_err(|error| format!("无法卸载扩展安装包: {error}"))?;
        self.runtimes
            .lock()
            .map_err(|_| "扩展运行时状态锁定失败".to_string())?
            .remove(id);
        self.registry.remove(id);

        // 卸载扩展时，立即撤销并清除该扩展的所有权限授权记录（锁失败必须中止，避免内存/磁盘不一致）
        let mut permissions = self
            .permissions
            .lock()
            .map_err(|_| "扩展权限状态锁定失败".to_string())?;
        let prefix = format!("{id}:");
        permissions.retain(|k, _| !k.starts_with(&prefix) && k != id);
        drop(permissions);

        let mut session_permissions = self
            .session_permissions
            .lock()
            .map_err(|_| "扩展会话权限状态锁定失败".to_string())?;
        session_permissions.retain(|k| !k.starts_with(&prefix) && k != id);
        drop(session_permissions);

        self.persist_permissions();

        Ok(())
    }

    pub fn runtime_for(&self, id: &str) -> Result<Arc<ExtensionRuntime>, String> {
        let id = canonical_extension_id(id);
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
            // 纯 JS 扩展（如 VSIX demo）：借用 VSCode 兼容层的 WASM 运行时。
            // 兼容层缺失时给出明确错误，而不是让空字节落到 wasmtime 的 WAT 解析器里。
            match self.package("aurona.vscode-compat") {
                Some(compat_pkg) if !compat_pkg.wasm.is_empty() => compat_pkg.wasm.clone(),
                _ => {
                    return Err(
                        "该扩展为纯 JS 扩展，需要 VSCode 兼容层提供 WASM 运行时，但兼容层未就绪"
                            .to_string(),
                    );
                }
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

    /// 读取扩展在某权限上的"生效"状态。
    ///
    /// 查找顺序：工作区授权 → 全局授权 → 会话授权（once）→ 内置扩展默认值。
    /// 都未命中时返回 `Unknown`，含义是"需要用户决定"，**不会**自动弹窗——
    /// 弹窗由扩展主动调用 `request-permission` 触发，前端据此展示三选一。
    pub fn permission(
        &self,
        extension_id: &str,
        permission: &str,
        workspace_identity: &str,
    ) -> ContextPermissionState {
        let extension_id = canonical_extension_id(extension_id);
        let workspace_key = permission_key(extension_id, permission, Some(workspace_identity));
        let global_key = permission_key(extension_id, permission, None);

        if let Ok(guard) = self.permissions.lock() {
            if let Some(state) = guard.get(&workspace_key) {
                return *state;
            }
            if let Some(state) = guard.get(&global_key) {
                return *state;
            }
        }
        if let Ok(guard) = self.session_permissions.lock() {
            if guard.contains(&workspace_key) || guard.contains(&global_key) {
                return ContextPermissionState::Granted;
            }
        }
        if is_builtin_extension(extension_id) && permission == "editor.current.read" {
            return ContextPermissionState::Granted;
        }
        ContextPermissionState::Unknown
    }

    /// 持久化一次授权决定。
    ///
    /// - [`PermissionScope::Workspace`]：只对当前工作区生效（key 带工作区身份）
    /// - [`PermissionScope::Global`]：跨工作区生效
    ///
    /// 拒绝为未开放的权限写授权记录（fail-closed）。
    pub fn set_permission(
        &self,
        extension_id: &str,
        permission: &str,
        workspace_identity: Option<&str>,
        granted: bool,
        scope: PermissionScope,
    ) -> Result<ContextPermissionState, String> {
        super::permissions::ensure_requestable(permission)?;
        let extension_id = canonical_extension_id(extension_id);
        let key = match scope {
            PermissionScope::Global => permission_key(extension_id, permission, None),
            PermissionScope::Workspace => permission_key(
                extension_id,
                permission,
                Some(workspace_identity.ok_or("按工作区授权需要工作区身份")?),
            ),
            PermissionScope::Once => {
                return Ok(self.set_session_permission(
                    extension_id,
                    permission,
                    workspace_identity.unwrap_or("none"),
                    granted,
                ))
            }
        };
        let state = if granted {
            ContextPermissionState::Granted
        } else {
            ContextPermissionState::Denied
        };
        self.permissions
            .lock()
            .map_err(|_| "扩展权限状态锁已损坏".to_string())?
            .insert(key, state);
        self.persist_permissions();
        Ok(state)
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
        if super::permissions::ensure_requestable(permission).is_err() {
            return ContextPermissionState::Denied;
        }
        let extension_id = canonical_extension_id(extension_id);
        let key = permission_key(extension_id, permission, Some(workspace_identity));
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

    /// 撤销授权：删除持久化与 session 记录，把权限恢复为 `unknown`（下次使用时重新询问）。
    /// 与 `set_permission(granted=false)` 的区别：后者是显式"拒绝"决定，撤销则是抹掉决定。
    /// `permission` 为 `None` 时撤销该扩展的全部权限（"全部撤销"入口）。
    /// 返回删除的记录条数。
    pub fn revoke_permission(
        &self,
        extension_id: &str,
        permission: Option<&str>,
    ) -> Result<usize, String> {
        let extension_id = canonical_extension_id(extension_id);
        let prefix = match permission {
            Some(permission) => format!("{extension_id}:{permission}:"),
            None => format!("{extension_id}:"),
        };
        let mut removed = 0usize;
        {
            let mut guard = self
                .permissions
                .lock()
                .map_err(|_| "扩展权限状态锁已损坏".to_string())?;
            let stale: Vec<String> = guard
                .keys()
                .filter(|key| key.starts_with(&prefix))
                .cloned()
                .collect();
            for key in stale {
                guard.remove(&key);
                removed += 1;
            }
        }
        if let Ok(mut guard) = self.session_permissions.lock() {
            let stale: Vec<String> = guard
                .iter()
                .filter(|key| key.starts_with(&prefix))
                .cloned()
                .collect();
            for key in stale {
                guard.remove(&key);
                removed += 1;
            }
        }
        if removed > 0 {
            self.persist_permissions();
        }
        Ok(removed)
    }

    /// 扩展升级后的权限 reconcile（fail-closed）：
    /// - 仍被新版本声明的权限：保留历史授权记录（granted/denied 均保留）；
    /// - 新版本**不再声明**的权限：历史决定立即清除，避免残留越权授权；
    /// - 新声明的权限：无任何记录，自然回落为 `unknown`（首次使用重新询问）。
    fn reconcile_permissions_on_upgrade(&self, extension_id: &str, new_declared: &[String]) {
        let extension_id = canonical_extension_id(extension_id);
        let prefix = format!("{extension_id}:");
        let declared_prefixes: HashSet<String> = new_declared
            .iter()
            .map(|permission| format!("{prefix}{permission}:"))
            .collect();
        {
            let mut guard = self
                .permissions
                .lock()
                .map_err(|_| "扩展权限状态锁已损坏".to_string())
                .ok();
            if let Some(guard) = guard.as_mut() {
                // 只清理属于该扩展、且不再被新版本声明的记录；其他扩展的记录不能动。
                guard.retain(|key, _| {
                    if !key.starts_with(&prefix) {
                        return true;
                    }
                    declared_prefixes
                        .iter()
                        .any(|d| key.starts_with(d.as_str()))
                });
            }
        }
        if let Ok(mut guard) = self.session_permissions.lock() {
            guard.retain(|key| {
                if !key.starts_with(&prefix) {
                    return true;
                }
                declared_prefixes
                    .iter()
                    .any(|d| key.starts_with(d.as_str()))
            });
        }
        self.persist_permissions();
    }

    /// 查询当前生效授权来自哪个作用域：`"global"` / `"workspace"` / `"once"` / `"unknown"`。
    /// 同一权限多作用域都有记录时，按 宽 > 窄 顺序报告（global > workspace > once）。
    pub fn permission_scope(
        &self,
        extension_id: &str,
        permission: &str,
        workspace_identity: &str,
    ) -> &'static str {
        let extension_id = canonical_extension_id(extension_id);
        let prefix = format!("{extension_id}:{permission}:");
        if let Ok(guard) = self.permissions.lock() {
            if guard.contains_key(&format!("{prefix}global")) {
                return "global";
            }
            if guard.contains_key(&format!("{prefix}{workspace_identity}")) {
                return "workspace";
            }
        }
        if let Ok(guard) = self.session_permissions.lock() {
            if guard.contains(&format!("{prefix}{workspace_identity}")) {
                return "once";
            }
        }
        "unknown"
    }

    fn load_permissions(&self, config_dir: &std::path::Path) -> bool {
        let path = config_dir.join(PERMISSIONS_FILE);
        let Ok(content) = std::fs::read_to_string(path) else {
            return false;
        };
        let Ok(values) = serde_json::from_str::<HashMap<String, String>>(&content) else {
            return false;
        };
        let mut normalized = HashMap::new();
        let mut migrated = false;
        for (key, value) in values {
            let state = match value.as_str() {
                "granted" => ContextPermissionState::Granted,
                "denied" => ContextPermissionState::Denied,
                _ => continue,
            };
            let canonical_key = canonicalize_permission_key(&key);
            migrated |= canonical_key != key;
            if canonical_key == key || !normalized.contains_key(&canonical_key) {
                normalized.insert(canonical_key, state);
            }
        }
        if let Ok(mut guard) = self.permissions.lock() {
            guard.extend(normalized);
        }
        migrated
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
    matches!(extension_id, "aurona.vscode-compat")
}

fn canonicalize_permission_key(key: &str) -> String {
    let Some((extension_id, remainder)) = key.split_once(':') else {
        return canonical_extension_id(key).to_string();
    };
    format!("{}:{remainder}", canonical_extension_id(extension_id))
}

impl Default for ExtensionState {
    fn default() -> Self {
        Self::new()
    }
}

fn permission_key(
    extension_id: &str,
    permission: &str,
    workspace_identity: Option<&str>,
) -> String {
    match workspace_identity {
        Some(identity) => format!("{extension_id}:{permission}:{identity}"),
        // 全局作用域使用固定字面量，与既有 `{ext}:{perm}:{workspace}` 格式共存
        None => format!("{extension_id}:{permission}:global"),
    }
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
    fn permission_keys_migrate_legacy_extension_ids() {
        assert_eq!(
            canonicalize_permission_key("aurona.markdown:editor.current.read:ws-a"),
            "auronalabs.markdown:editor.current.read:ws-a"
        );
        assert_eq!(
            canonicalize_permission_key("custom.extension"),
            "custom.extension"
        );
    }

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

        state
            .set_permission(
                "custom.extension",
                "editor.current.read",
                Some("ws-a"),
                true,
                PermissionScope::Workspace,
            )
            .unwrap();
        assert_eq!(
            state.permission("custom.extension", "editor.current.read", "ws-a"),
            ContextPermissionState::Granted
        );
        // 按工作区授权不应泄漏到其他工作区
        assert_eq!(
            state.permission("custom.extension", "editor.current.read", "ws-b"),
            ContextPermissionState::Unknown
        );

        state
            .set_permission(
                "aurona.vscode-compat",
                "editor.current.read",
                Some("ws-a"),
                false,
                PermissionScope::Workspace,
            )
            .unwrap();
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
        state
            .set_permission(
                "aurona.vscode-compat",
                "workspace.read",
                Some("ws-a"),
                true,
                PermissionScope::Workspace,
            )
            .unwrap();
        assert_eq!(
            state.permission("aurona.vscode-compat", "workspace.read", "ws-a"),
            ContextPermissionState::Granted
        );
    }

    #[test]
    fn global_scope_grants_across_workspaces() {
        let state = ExtensionState::new();
        state
            .set_permission(
                "custom.extension",
                "workspace.read",
                Some("ws-a"),
                true,
                PermissionScope::Global,
            )
            .expect("global grant should succeed");

        // 全局授权对所有工作区生效
        assert_eq!(
            state.permission("custom.extension", "workspace.read", "ws-a"),
            ContextPermissionState::Granted
        );
        assert_eq!(
            state.permission("custom.extension", "workspace.read", "ws-b"),
            ContextPermissionState::Granted
        );
        assert_eq!(
            state.permission("custom.extension", "workspace.read", "none"),
            ContextPermissionState::Granted
        );

        // 但工作区级拒绝优先于全局授权（用户在某个工作区明确说过"不"）
        state
            .set_permission(
                "custom.extension",
                "workspace.read",
                Some("ws-b"),
                false,
                PermissionScope::Workspace,
            )
            .expect("workspace deny should succeed");
        assert_eq!(
            state.permission("custom.extension", "workspace.read", "ws-b"),
            ContextPermissionState::Denied
        );
    }

    #[test]
    fn set_permission_refuses_unavailable_permissions() {
        let state = ExtensionState::new();
        let error = state
            .set_permission(
                "custom.extension",
                "terminal.execute",
                Some("ws-a"),
                true,
                PermissionScope::Workspace,
            )
            .unwrap_err();
        assert!(error.contains("尚未开放"), "{error}");
    }

    #[test]
    fn once_scope_is_session_only_and_not_persisted() {
        let state = ExtensionState::new();
        state
            .set_permission(
                "custom.extension",
                "editor.current.read",
                Some("ws-a"),
                true,
                PermissionScope::Once,
            )
            .unwrap();
        assert_eq!(
            state.permission("custom.extension", "editor.current.read", "ws-a"),
            ContextPermissionState::Granted
        );
        // once 不落盘：重启后（重建实例）应回到 Unknown
        let reloaded = ExtensionState::new();
        assert_eq!(
            reloaded.permission("custom.extension", "editor.current.read", "ws-a"),
            ContextPermissionState::Unknown
        );
    }

    #[test]
    fn upgrade_reconcile_keeps_declared_and_drops_undeclared() {
        let state = ExtensionState::new();
        state
            .set_permission(
                "custom.extension",
                "editor.current.read",
                Some("ws-a"),
                true,
                PermissionScope::Workspace,
            )
            .unwrap();
        state
            .set_permission(
                "custom.extension",
                "workspace.read",
                Some("ws-a"),
                true,
                PermissionScope::Global,
            )
            .unwrap();
        state
            .set_permission(
                "custom.extension",
                "workspace.write",
                Some("ws-a"),
                false,
                PermissionScope::Workspace,
            )
            .unwrap();
        assert_eq!(
            state.permission("custom.extension", "workspace.write", "ws-a"),
            ContextPermissionState::Denied
        );

        // 新版本只声明 editor.current.read：保留授权，其余历史决定清除
        state.reconcile_permissions_on_upgrade(
            "custom.extension",
            &["editor.current.read".to_string()],
        );
        assert_eq!(
            state.permission("custom.extension", "editor.current.read", "ws-a"),
            ContextPermissionState::Granted
        );
        assert_eq!(
            state.permission("custom.extension", "workspace.read", "ws-a"),
            ContextPermissionState::Unknown
        );
        // 曾经的"拒绝"决定也被抹掉（fail-closed 而非保留拒绝）
        assert_eq!(
            state.permission("custom.extension", "workspace.write", "ws-a"),
            ContextPermissionState::Unknown
        );

        // 恢复声明 workspace.read 后：无记录，回到 unknown（重新询问），不会自动恢复授权
        state.reconcile_permissions_on_upgrade(
            "custom.extension",
            &[
                "editor.current.read".to_string(),
                "workspace.read".to_string(),
            ],
        );
        assert_eq!(
            state.permission("custom.extension", "editor.current.read", "ws-a"),
            ContextPermissionState::Granted
        );
        assert_eq!(
            state.permission("custom.extension", "workspace.read", "ws-a"),
            ContextPermissionState::Unknown
        );

        // 不影响其他扩展的授权
        state
            .set_permission(
                "other.extension",
                "workspace.read",
                Some("ws-a"),
                true,
                PermissionScope::Workspace,
            )
            .unwrap();
        state.reconcile_permissions_on_upgrade("custom.extension", &["workspace.read".to_string()]);
        assert_eq!(
            state.permission("other.extension", "workspace.read", "ws-a"),
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
