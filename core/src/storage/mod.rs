mod memory;
mod postgres;
mod storage_trait;
mod types;

pub use memory::MemoryBackend;
pub use postgres::PostgresBackend;
pub use storage_trait::StorageBackend;
pub use types::*;

use crate::config::StorageConfig;
use anyhow::Result;
use std::sync::Arc;

/// Create a storage backend based on the configuration
pub async fn create_storage_backend(config: &StorageConfig) -> Result<Arc<dyn StorageBackend>> {
    match config.backend.as_str() {
        "memory" => {
            tracing::info!("💾 Storage Backend: In-Memory (data will not persist across restarts)");
            let backend = MemoryBackend::new(config)?;
            Ok(Arc::new(backend))
        }
        "postgres" | "supabase" => {
            let backend_type = if config.backend == "supabase" {
                "Supabase (PostgreSQL)"
            } else {
                "PostgreSQL"
            };
            tracing::info!("💾 Storage Backend: {} (persistent)", backend_type);
            let backend = PostgresBackend::new(config).await?;
            tracing::info!("✅ Database connection established");
            Ok(Arc::new(backend))
        }
        "mysql" => {
            anyhow::bail!(
                "MySQL backend not yet implemented. Use 'memory' or 'postgres' backend for now."
            )
        }
        "sqlite" => {
            anyhow::bail!(
                "SQLite backend not yet implemented. Use 'memory' or 'postgres' backend for now."
            )
        }
        other => {
            anyhow::bail!("Unknown storage backend: {}", other)
        }
    }
}
