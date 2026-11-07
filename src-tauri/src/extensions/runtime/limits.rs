//! Shared component resource budgets for construction and execution.
use super::*;

#[derive(Debug, Clone, Copy)]
pub struct ExtensionLimits {
    pub memory_bytes: usize,
    pub fuel: u64,
    pub persistent: bool,
}

impl ExtensionLimits {
    // Rust/Boa components need more than 2,048 entries during instantiation.
    // Keep the same bounded policy for initial contexts and live stores.
    pub(super) fn store_limits(&self) -> StoreLimits {
        StoreLimitsBuilder::new()
            .memory_size(self.memory_bytes)
            .table_elements(65_536)
            .instances(16)
            .memories(16)
            .build()
    }
}

impl Default for ExtensionLimits {
    fn default() -> Self {
        Self {
            memory_bytes: DEFAULT_MEMORY_BYTES,
            fuel: DEFAULT_FUEL,
            persistent: false,
        }
    }
}

impl ExtensionLimits {
    pub fn trusted_compat() -> Self {
        Self {
            memory_bytes: 256 * 1024 * 1024,
            fuel: 4_000_000_000,
            persistent: true,
        }
    }
}
