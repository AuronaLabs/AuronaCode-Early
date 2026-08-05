use serde::Serialize;
use ts_rs::TS;

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlatformInfo {
    pub operating_system: String,
    pub architecture: String,
    pub family: String,
    pub default_shell: Option<String>,
    pub desktop_session: Option<String>,
    pub path_restored: bool,
}

static PATH_RESTORED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

pub fn initialize_environment() {
    #[cfg(unix)]
    let restored = fix_path_env::fix().is_ok();
    #[cfg(not(unix))]
    let restored = false;
    let _ = PATH_RESTORED.set(restored);
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    PlatformInfo {
        operating_system: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        family: std::env::consts::FAMILY.to_string(),
        default_shell: std::env::var("SHELL")
            .ok()
            .filter(|value| !value.trim().is_empty()),
        desktop_session: desktop_session(),
        path_restored: PATH_RESTORED.get().copied().unwrap_or(false),
    }
}

fn desktop_session() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_SESSION_TYPE")
            .ok()
            .map(|value| value.to_ascii_lowercase())
            .filter(|value| matches!(value.as_str(), "wayland" | "x11"))
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::platform_info;

    #[test]
    fn reports_compile_time_platform_without_user_agent_sniffing() {
        let info = platform_info();
        assert_eq!(info.operating_system, std::env::consts::OS);
        assert_eq!(info.architecture, std::env::consts::ARCH);
        assert_eq!(info.family, std::env::consts::FAMILY);
    }
}
