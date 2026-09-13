//! 扩展权限目录 —— 权限系统的唯一真相源。
//!
//! 设计原则（见 .trae/documents/v0.4.0-stable-implementation-plan.md §4）：
//! 1. **声明**：扩展在 manifest.json 的 `permissions` 里声明它需要的权限。
//! 2. **审查**：安装期校验声明的 id 必须在本目录且 `available`，否则直接拒绝安装。
//! 3. **授予**：三态（unknown / granted / denied）+ 三种作用域（once / workspace / global）。
//! 4. **强制**：运行时一切判断只走 [`definition`] 与 [`ExtensionContext::require`]，
//!    不再允许散落的字符串 match。
//!
//! 前端不维护自己的权限表：通过 IPC `extensions_permission_catalog` 拉取本目录，
//! 按"该扩展声明的权限"渲染开关，而不是渲染一套固定的全量列表。

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionLevel {
    Normal,
    Sensitive,
    Critical,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionDefinition {
    pub id: &'static str,
    pub level: PermissionLevel,
    /// i18n key：`extensions.permission.<segment>.name`
    pub title_key: &'static str,
    /// i18n key：`extensions.permission.<segment>.description`
    pub description_key: &'static str,
    /// 当前版本是否真的实现了强制拦截与对应能力。
    /// 未开放的权限在安装审查阶段就会被拒绝，避免扩展声明了却永远拿不到。
    pub available: bool,
}

/// 权限目录。新增权限时在这里登记，**不要**在前端另建一份表。
pub const PERMISSIONS: &[PermissionDefinition] = &[
    PermissionDefinition {
        id: "editor.current.read",
        level: PermissionLevel::Normal,
        title_key: "extensions.permission.editorCurrentRead.name",
        description_key: "extensions.permission.editorCurrentRead.description",
        available: true,
    },
    PermissionDefinition {
        id: "editor.current.write",
        level: PermissionLevel::Sensitive,
        title_key: "extensions.permission.editorCurrentWrite.name",
        description_key: "extensions.permission.editorCurrentWrite.description",
        // insert_editor_text / reveal_editor_line 已通过前端编辑器桥打通，见 runtime.rs
        available: true,
    },
    PermissionDefinition {
        id: "workspace.read",
        level: PermissionLevel::Sensitive,
        title_key: "extensions.permission.workspaceRead.name",
        description_key: "extensions.permission.workspaceRead.description",
        available: true,
    },
    PermissionDefinition {
        id: "workspace.write",
        level: PermissionLevel::Critical,
        title_key: "extensions.permission.workspaceWrite.name",
        description_key: "extensions.permission.workspaceWrite.description",
        available: true,
    },
    PermissionDefinition {
        id: "clipboard.access",
        level: PermissionLevel::Normal,
        title_key: "extensions.permission.clipboardAccess.name",
        description_key: "extensions.permission.clipboardAccess.description",
        // read/write_clipboard 目前是占位实现，见 runtime.rs
        available: false,
    },
    PermissionDefinition {
        id: "fliuno.search",
        level: PermissionLevel::Normal,
        title_key: "extensions.permission.fliunoSearch.name",
        description_key: "extensions.permission.fliunoSearch.description",
        available: true,
    },
    PermissionDefinition {
        id: "git.read",
        level: PermissionLevel::Normal,
        title_key: "extensions.permission.gitRead.name",
        description_key: "extensions.permission.gitRead.description",
        // SDK v1.1 的 git 只读接口（info/status/log/diff）
        available: true,
    },
    PermissionDefinition {
        id: "git.write",
        level: PermissionLevel::Critical,
        title_key: "extensions.permission.gitWrite.name",
        description_key: "extensions.permission.gitWrite.description",
        // SDK v1.1 的 git 写接口（stage/unstage/commit）
        available: true,
    },
    PermissionDefinition {
        id: "terminal.execute",
        level: PermissionLevel::Critical,
        title_key: "extensions.permission.terminalExecute.name",
        description_key: "extensions.permission.terminalExecute.description",
        available: false,
    },
];

pub fn definition(id: &str) -> Option<&'static PermissionDefinition> {
    PERMISSIONS.iter().find(|entry| entry.id == id)
}

/// 授权作用域。三种作用域在 UI 上必须显式区分，否则用户无法理解
/// "我明明开了，换个目录怎么又要授权"。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionScope {
    /// 仅本次（只存在于当前进程，不落盘）
    Once,
    /// 仅当前工作区（持久化）
    Workspace,
    /// 跨工作区（持久化）
    Global,
}

/// 安装期审查：manifest 声明的权限必须存在且已开放，否则拒绝安装。
pub fn validate_declared(declared: &[String]) -> Result<(), String> {
    for id in declared {
        let Some(entry) = definition(id) else {
            return Err(format!("manifest 声明了未知权限: {id}"));
        };
        if !entry.available {
            return Err(format!(
                "manifest 声明的权限 {} 在当前版本尚未开放，请移除该声明",
                entry.id
            ));
        }
    }
    Ok(())
}

/// 运行期判断：该权限是否真的能被授予。
/// 对未开放的权限返回明确错误，而不是静默失败。
pub fn ensure_requestable(id: &str) -> Result<(), String> {
    match definition(id) {
        None => Err(format!("未知权限: {id}")),
        Some(entry) if !entry.available => Err(format!("权限 {} 在当前版本尚未开放", entry.id)),
        Some(_) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for entry in PERMISSIONS {
            assert!(seen.insert(entry.id), "权限目录出现重复 id: {}", entry.id);
        }
    }

    #[test]
    fn i18n_keys_follow_the_id_segment() {
        for entry in PERMISSIONS {
            let segment: String = entry
                .id
                .split('.')
                .enumerate()
                .map(|(index, part)| {
                    if index == 0 {
                        part.to_string()
                    } else {
                        format!(
                            "{}{}",
                            part.chars().next().unwrap().to_uppercase(),
                            &part[1..]
                        )
                    }
                })
                .collect();
            assert!(
                entry.title_key.ends_with(&format!("{segment}.name")),
                "{} 的 title_key 与 id 不匹配: {}",
                entry.id,
                entry.title_key
            );
            assert!(
                entry
                    .description_key
                    .ends_with(&format!("{segment}.description")),
                "{} 的 description_key 与 id 不匹配: {}",
                entry.id,
                entry.description_key
            );
        }
    }

    #[test]
    fn validate_declared_rejects_unknown_and_unavailable() {
        assert!(validate_declared(&["workspace.read".to_string()]).is_ok());
        assert!(validate_declared(&[]).is_ok());
        assert!(validate_declared(&["git.read".to_string()]).is_ok());
        assert!(validate_declared(&["not.a.permission".to_string()]).is_err());
        // terminal.execute 已登记但未开放，声明它应当在安装期就被拦下
        assert!(validate_declared(&["terminal.execute".to_string()]).is_err());
    }

    #[test]
    fn ensure_requestable_gives_a_clear_error_for_unavailable_permissions() {
        assert!(ensure_requestable("workspace.read").is_ok());
        assert!(ensure_requestable("git.read").is_ok());
        assert!(ensure_requestable("git.write").is_ok());
        assert!(ensure_requestable("made.up").is_err());
        let error = ensure_requestable("terminal.execute").unwrap_err();
        assert!(error.contains("尚未开放"), "错误信息应明确: {error}");
    }
}
