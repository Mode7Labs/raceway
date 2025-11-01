use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::str::FromStr;

/// Main configuration structure for Raceway.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[derive(Default)]
pub struct Config {
    #[serde(default)]
    pub server: ServerConfig,

    #[serde(default)]
    pub storage: StorageConfig,

    #[serde(default)]
    pub engine: EngineConfig,

    #[serde(default)]
    pub race_detection: RaceDetectionConfig,

    #[serde(default)]
    pub anomaly_detection: AnomalyDetectionConfig,

    #[serde(default)]
    pub distributed_tracing: DistributedTracingConfig,

    #[serde(default)]
    pub logging: LoggingConfig,

    #[serde(default)]
    pub development: DevelopmentConfig,
}

impl Config {
    /// Load configuration from a TOML file.
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let contents =
            std::fs::read_to_string(path.as_ref()).context("Failed to read config file")?;

        let config: Config = toml::from_str(&contents).context("Failed to parse config file")?;

        Ok(config)
    }

    /// Load configuration from a TOML file, falling back to defaults if the file is missing.
    pub fn from_file_or_default<P: AsRef<Path>>(path: P) -> Self {
        match Self::from_file(&path) {
            Ok(config) => config,
            Err(e) => {
                tracing::warn!(
                    "Failed to load config from {:?}: {}. Using defaults.",
                    path.as_ref(),
                    e
                );
                Self::default()
            }
        }
    }

    /// Get the default configuration as a TOML string.
    pub fn default_toml() -> Result<String> {
        let config = Self::default();
        toml::to_string_pretty(&config).context("Failed to serialize default config")
    }

    /// Validate the configuration for obvious misconfiguration.
    pub fn validate(&self) -> Result<()> {
        match self.storage.backend.as_str() {
            "memory" | "postgres" | "supabase" => {}
            other => anyhow::bail!("Invalid storage backend: {}", other),
        }

        if matches!(self.storage.backend.as_str(), "postgres" | "supabase")
            && self.storage.postgres.connection_string.is_none() {
                anyhow::bail!("PostgreSQL/Supabase backend requires connection_string");
            }

        if self.server.port == 0 {
            anyhow::bail!("Server port cannot be 0");
        }

        if self.server.rate_limit_enabled && self.server.rate_limit_rpm == 0 {
            anyhow::bail!("rate_limit_rpm must be greater than 0 when rate limiting is enabled");
        }

        match self.logging.level.to_lowercase().as_str() {
            "trace" | "debug" | "info" | "warn" | "error" => {}
            other => anyhow::bail!("Invalid log level: {}", other),
        }

        Ok(())
    }
}

impl FromStr for Config {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        let config: Config = toml::from_str(s).context("Failed to parse config")?;
        Ok(config)
    }
}

/// Runtime server configuration.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,

    #[serde(default = "default_port")]
    pub port: u16,

    #[serde(default)]
    pub verbose: bool,

    #[serde(default = "default_true")]
    pub cors_enabled: bool,

    #[serde(default = "default_cors_origins")]
    pub cors_origins: Vec<String>,

    #[serde(default)]
    pub rate_limit_enabled: bool,

    #[serde(default = "default_rate_limit_rpm")]
    pub rate_limit_rpm: u32,

    #[serde(default)]
    pub auth_enabled: bool,

    #[serde(default)]
    pub api_keys: Vec<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            verbose: false,
            cors_enabled: true,
            cors_origins: default_cors_origins(),
            rate_limit_enabled: false,
            rate_limit_rpm: default_rate_limit_rpm(),
            auth_enabled: false,
            api_keys: Vec::new(),
        }
    }
}

/// Storage configuration.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StorageConfig {
    #[serde(default = "default_storage_backend")]
    pub backend: String,

    #[serde(default)]
    pub postgres: PostgresConfig,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            backend: default_storage_backend(),
            postgres: PostgresConfig::default(),
        }
    }
}

/// PostgreSQL settings (used for both Postgres and Supabase deployments).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PostgresConfig {
    pub connection_string: Option<String>,

    #[serde(default = "default_max_connections")]
    pub max_connections: u32,

    #[serde(default = "default_min_connections")]
    pub min_connections: u32,

    #[serde(default = "default_connection_timeout")]
    pub connection_timeout_seconds: u32,

    #[serde(default = "default_true")]
    pub auto_migrate: bool,
}

impl Default for PostgresConfig {
    fn default() -> Self {
        Self {
            connection_string: None,
            max_connections: default_max_connections(),
            min_connections: default_min_connections(),
            connection_timeout_seconds: default_connection_timeout(),
            auto_migrate: true,
        }
    }
}

/// Engine tuning configuration.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EngineConfig {
    #[serde(default = "default_buffer_size")]
    pub buffer_size: usize,

    #[serde(default = "default_batch_size")]
    pub batch_size: usize,

    #[serde(default = "default_flush_interval")]
    pub flush_interval_ms: u64,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            buffer_size: default_buffer_size(),
            batch_size: default_batch_size(),
            flush_interval_ms: default_flush_interval(),
        }
    }
}

/// Controls whether race detection is enabled.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RaceDetectionConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl Default for RaceDetectionConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

/// Controls whether anomaly detection is enabled.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AnomalyDetectionConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl Default for AnomalyDetectionConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

/// Controls whether distributed tracing is enabled (Phase 2).
///
/// When enabled:
/// - Events with distributed_span_id create spans and edges in distributed tables
/// - Traces are merged across services using recursive BFS
/// - Critical path and race detection span services
/// - Vector clocks track causality across service boundaries
///
/// When disabled:
/// - Each service's events remain isolated
/// - Distributed metadata ignored (backward compatible)
/// - Single-service behavior unchanged
#[derive(Debug, Clone, Deserialize, Serialize)]
#[derive(Default)]
pub struct DistributedTracingConfig {
    #[serde(default = "default_false")]
    pub enabled: bool,
}


/// Logging configuration.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoggingConfig {
    #[serde(default = "default_log_level")]
    pub level: String,

    #[serde(default)]
    pub include_modules: bool,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: default_log_level(),
            include_modules: false,
        }
    }
}

/// Development-only toggles.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct DevelopmentConfig {
    #[serde(default)]
    pub cors_allow_all: bool,
}

// Default providers ---------------------------------------------------------

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_port() -> u16 {
    8080
}

fn default_true() -> bool {
    true
}

fn default_false() -> bool {
    false
}

fn default_cors_origins() -> Vec<String> {
    vec!["*".to_string()]
}

fn default_rate_limit_rpm() -> u32 {
    1000
}

fn default_storage_backend() -> String {
    "memory".to_string()
}

fn default_max_connections() -> u32 {
    10
}

fn default_min_connections() -> u32 {
    2
}

fn default_connection_timeout() -> u32 {
    30
}

fn default_buffer_size() -> usize {
    10_000
}

fn default_batch_size() -> usize {
    100
}

fn default_flush_interval() -> u64 {
    100
}

fn default_log_level() -> String {
    "info".to_string()
}

// Tests ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.server.host, "127.0.0.1");
        assert_eq!(config.server.port, 8080);
        assert_eq!(config.storage.backend, "memory");
        assert!(config.race_detection.enabled);
        assert!(config.anomaly_detection.enabled);
    }

    #[test]
    fn test_validate_valid_config() {
        let config = Config::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validate_invalid_storage_backend() {
        let mut config = Config::default();
        config.storage.backend = "invalid".to_string();
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_postgres_requires_connection_string() {
        let mut config = Config::default();
        config.storage.backend = "postgres".to_string();
        config.storage.postgres.connection_string = None;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_parse_toml() {
        let toml_str = r#"
            [server]
            host = "0.0.0.0"
            port = 3000

            [storage]
            backend = "postgres"

            [storage.postgres]
            connection_string = "postgres://localhost/test"

            [logging]
            level = "debug"
        "#;

        let config = Config::from_str(toml_str).unwrap();
        assert_eq!(config.server.host, "0.0.0.0");
        assert_eq!(config.server.port, 3000);
        assert_eq!(config.storage.backend, "postgres");
        assert_eq!(
            config.storage.postgres.connection_string,
            Some("postgres://localhost/test".to_string())
        );
        assert_eq!(config.logging.level, "debug");
    }
}
