//! One policy snapshot per operation; updater signatures are deliberately unrelated.
#[derive(Clone, Copy, Debug)]
pub struct ExtensionSecurityPolicy {
    pub package_signature: bool,
}

impl ExtensionSecurityPolicy {
    pub fn load(app: &tauri::AppHandle) -> Self {
        Self {
            package_signature: crate::authorization_dialogs::security_preference(
                app,
                "requireExtensionSignature",
                true,
            ),
        }
    }

    pub fn require_package(&self, authenticated: bool) -> Result<(), String> {
        if self.package_signature && !authenticated {
            return Err("[signature.required] Extension package authentication is required. You can disable it in Settings > Security.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_packages_require_authentication_unless_explicitly_relaxed() {
        let strict = ExtensionSecurityPolicy {
            package_signature: true,
        };
        assert!(strict.require_package(false).is_err());
        assert!(strict.require_package(true).is_ok());
        let relaxed = ExtensionSecurityPolicy {
            package_signature: false,
        };
        assert!(relaxed.require_package(false).is_ok());
    }
}
