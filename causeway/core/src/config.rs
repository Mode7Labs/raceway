use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Main configuration structure for Raceway
#[derive(Debug, Clone, Deserialize, Serialize)]
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
    pub critical_path: CriticalPathConfig,

    #[serde(default)]
    pub instrumentation: InstrumentationConfig,

    #[serde(default)]
    pub export: ExportConfig,

    #[serde(default)]
    pub web_ui: WebUiConfig,

    #[serde(default)]
    pub logging: LoggingConfig,

    #[serde(default)]
    pub metrics: MetricsConfig,

    #[serde(default)]
    pub alerting: AlertingConfig,

    #[serde(default)]
    pub development: DevelopmentConfig,

    #[serde(default)]
    pub experimental: ExperimentalConfig,
}

/// Server configuration
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

    pub auth_type: Option<String>,
    pub api_keys: Option<Vec<String>>,

    #[serde(default)]
    pub tls_enabled: bool,

    pub tls_cert_path: Option<PathBuf>,
    pub tls_key_path: Option<PathBuf>,
}

/// Storage configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StorageConfig {
    #[serde(default = "default_storage_backend")]
    pub backend: String,

    #[serde(default = "default_retention_hours")]
    pub retention_hours: u32,

    #[serde(default = "default_max_events")]
    pub max_events_in_memory: usize,

    #[serde(default)]
    pub memory: MemoryStorageConfig,

    #[serde(default)]
    pub postgres: PostgresConfig,

    #[serde(default)]
    pub mysql: MysqlConfig,

    #[serde(default)]
    pub sqlite: SqliteConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct MemoryStorageConfig {
    #[serde(default)]
    pub persist_on_shutdown: bool,

    pub persist_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct PostgresConfig {
    #[serde(default)]
    pub enabled: bool,

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

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct MysqlConfig {
    #[serde(default)]
    pub enabled: bool,

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

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct SqliteConfig {
    #[serde(default)]
    pub enabled: bool,

    pub database_path: Option<PathBuf>,

    #[serde(default = "default_true")]
    pub auto_migrate: bool,
}

/// Engine configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EngineConfig {
    #[serde(default = "default_buffer_size")]
    pub buffer_size: usize,

    #[serde(default = "default_batch_size")]
    pub batch_size: usize,

    #[serde(default = "default_flush_interval")]
    pub flush_interval_ms: u64,

    #[serde(default)]
    pub sampling_enabled: bool,

    #[serde(default = "default_sampling_rate")]
    pub sampling_rate: f64,

    pub always_trace_header: Option<String>,
    pub always_trace_value: Option<String>,

    #[serde(default = "default_worker_threads")]
    pub worker_threads: usize,

    #[serde(default = "default_async_threads")]
    pub async_runtime_threads: usize,

    #[serde(default = "default_max_trace_size")]
    pub max_trace_size_mb: usize,

    #[serde(default = "default_max_graph_nodes")]
    pub max_graph_nodes: usize,
}

/// Race detection configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RaceDetectionConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,

    #[serde(default = "default_true")]
    pub cross_trace_enabled: bool,

    #[serde(default = "default_concurrency_window")]
    pub concurrency_window_us: u64,

    #[serde(default)]
    pub ignore_read_only: bool,

    #[serde(default = "default_confidence_threshold")]
    pub confidence_threshold: f64,

    #[serde(default)]
    pub ignore_patterns: Vec<String>,

    #[serde(default)]
    pub safe_patterns: Vec<String>,

    #[serde(default = "default_true")]
    pub detect_lock_patterns: bool,

    #[serde(default = "default_lock_patterns")]
    pub lock_variable_patterns: Vec<String>,
}

/// Anomaly detection configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AnomalyDetectionConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,

    #[serde(default = "default_slow_threshold")]
    pub slow_operation_threshold_ms: u64,

    #[serde(default = "default_std_dev_threshold")]
    pub std_dev_threshold: f64,

    #[serde(default = "default_min_samples")]
    pub min_samples: usize,

    #[serde(default = "default_true")]
    pub detect_slow_operations: bool,

    #[serde(default = "default_true")]
    pub detect_timeouts: bool,

    #[serde(default = "default_true")]
    pub detect_retries: bool,

    #[serde(default = "default_true")]
    pub detect_unusual_patterns: bool,
}

/// Critical path configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CriticalPathConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,

    #[serde(default = "default_true")]
    pub include_async: bool,

    #[serde(default = "default_min_duration")]
    pub min_duration_ms: f64,
}

/// Instrumentation configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InstrumentationConfig {
    #[serde(default = "default_true")]
    pub auto_instrument: bool,

    #[serde(default)]
    pub capture_args: bool,

    #[serde(default)]
    pub capture_returns: bool,

    #[serde(default = "default_max_stack_depth")]
    pub max_stack_depth: usize,

    #[serde(default = "default_exclude_patterns")]
    pub exclude_patterns: Vec<String>,

    #[serde(default = "default_sensitive_patterns")]
    pub sensitive_patterns: Vec<String>,
}

/// Export configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExportConfig {
    #[serde(default)]
    pub enabled: bool,

    pub format: Option<String>,
    pub endpoint: Option<String>,
    pub batch_size: Option<usize>,
    pub interval_seconds: Option<u64>,
}

/// Web UI configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WebUiConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,

    pub custom_ui_path: Option<PathBuf>,

    #[serde(default = "default_page_size")]
    pub default_page_size: usize,

    #[serde(default = "default_max_timeline_events")]
    pub max_timeline_events: usize,
}

/// Logging configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoggingConfig {
    #[serde(default = "default_log_level")]
    pub level: String,

    #[serde(default = "default_log_format")]
    pub format: String,

    #[serde(default)]
    pub file_enabled: bool,

    pub file_path: Option<PathBuf>,
    pub file_max_size_mb: Option<usize>,
    pub file_max_backups: Option<usize>,

    #[serde(default = "default_true")]
    pub stdout_enabled: bool,

    #[serde(default = "default_true")]
    pub include_timestamps: bool,

    #[serde(default)]
    pub include_modules: bool,
}

/// Metrics configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MetricsConfig {
    #[serde(default)]
    pub enabled: bool,

    pub endpoint: Option<String>,
    pub update_interval_seconds: Option<u64>,
}

/// Alerting configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AlertingConfig {
    #[serde(default)]
    pub enabled: bool,

    pub alert_on_races: Option<bool>,
    pub alert_on_anomalies: Option<bool>,

    pub slack: Option<SlackConfig>,
    pub pagerduty: Option<PagerDutyConfig>,
    pub email: Option<EmailConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SlackConfig {
    pub webhook_url: String,
    pub channel: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PagerDutyConfig {
    pub integration_key: String,
    pub severity: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EmailConfig {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: String,
    pub smtp_password: String,
    pub from: String,
    pub to: Vec<String>,
}

/// Development configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DevelopmentConfig {
    #[serde(default)]
    pub dev_mode: bool,

    #[serde(default)]
    pub debug_endpoints: bool,

    #[serde(default)]
    pub pretty_json: bool,

    #[serde(default)]
    pub request_logging: bool,

    #[serde(default)]
    pub cors_allow_all: bool,
}

/// Experimental features configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExperimentalConfig {
    #[serde(default)]
    pub ai_anomaly_detection: bool,

    #[serde(default)]
    pub auto_test_generation: bool,

    #[serde(default)]
    pub deadlock_detection: bool,

    #[serde(default = "default_true")]
    pub distributed_tracing: bool,

    #[serde(default)]
    pub realtime_streaming: bool,
}

// Default value functions
fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_port() -> u16 {
    8080
}

fn default_true() -> bool {
    true
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

fn default_retention_hours() -> u32 {
    24
}

fn default_max_events() -> usize {
    100000
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
    10000
}

fn default_batch_size() -> usize {
    100
}

fn default_flush_interval() -> u64 {
    100
}

fn default_sampling_rate() -> f64 {
    1.0
}

fn default_worker_threads() -> usize {
    4
}

fn default_async_threads() -> usize {
    8
}

fn default_max_trace_size() -> usize {
    100
}

fn default_max_graph_nodes() -> usize {
    1000000
}

fn default_concurrency_window() -> u64 {
    1000
}

fn default_confidence_threshold() -> f64 {
    0.5
}

fn default_lock_patterns() -> Vec<String> {
    vec![
        ".*_lock".to_string(),
        ".*_mutex".to_string(),
        ".*_semaphore".to_string(),
    ]
}

fn default_slow_threshold() -> u64 {
    1000
}

fn default_std_dev_threshold() -> f64 {
    2.0
}

fn default_min_samples() -> usize {
    10
}

fn default_min_duration() -> f64 {
    1.0
}

fn default_max_stack_depth() -> usize {
    50
}

fn default_exclude_patterns() -> Vec<String> {
    vec![
        "**/node_modules/**".to_string(),
        "**/test/**".to_string(),
        "**/tests/**".to_string(),
        "**/*.test.*".to_string(),
        "**/*.spec.*".to_string(),
    ]
}

fn default_sensitive_patterns() -> Vec<String> {
    vec![
        "password".to_string(),
        "secret".to_string(),
        "token".to_string(),
        "api_key".to_string(),
        "credit_card".to_string(),
        "ssn".to_string(),
    ]
}

fn default_page_size() -> usize {
    50
}

fn default_max_timeline_events() -> usize {
    1000
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_log_format() -> String {
    "compact".to_string()
}

// Default implementations
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
            auth_type: None,
            api_keys: None,
            tls_enabled: false,
            tls_cert_path: None,
            tls_key_path: None,
        }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            backend: default_storage_backend(),
            retention_hours: default_retention_hours(),
            max_events_in_memory: default_max_events(),
            memory: MemoryStorageConfig::default(),
            postgres: PostgresConfig::default(),
            mysql: MysqlConfig::default(),
            sqlite: SqliteConfig::default(),
        }
    }
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            buffer_size: default_buffer_size(),
            batch_size: default_batch_size(),
            flush_interval_ms: default_flush_interval(),
            sampling_enabled: false,
            sampling_rate: default_sampling_rate(),
            always_trace_header: None,
            always_trace_value: None,
            worker_threads: default_worker_threads(),
            async_runtime_threads: default_async_threads(),
            max_trace_size_mb: default_max_trace_size(),
            max_graph_nodes: default_max_graph_nodes(),
        }
    }
}

impl Default for RaceDetectionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            cross_trace_enabled: true,
            concurrency_window_us: default_concurrency_window(),
            ignore_read_only: false,
            confidence_threshold: default_confidence_threshold(),
            ignore_patterns: vec![],
            safe_patterns: vec![],
            detect_lock_patterns: true,
            lock_variable_patterns: default_lock_patterns(),
        }
    }
}

impl Default for AnomalyDetectionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            slow_operation_threshold_ms: default_slow_threshold(),
            std_dev_threshold: default_std_dev_threshold(),
            min_samples: default_min_samples(),
            detect_slow_operations: true,
            detect_timeouts: true,
            detect_retries: true,
            detect_unusual_patterns: true,
        }
    }
}

impl Default for CriticalPathConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            include_async: true,
            min_duration_ms: default_min_duration(),
        }
    }
}

impl Default for InstrumentationConfig {
    fn default() -> Self {
        Self {
            auto_instrument: true,
            capture_args: false,
            capture_returns: false,
            max_stack_depth: default_max_stack_depth(),
            exclude_patterns: default_exclude_patterns(),
            sensitive_patterns: default_sensitive_patterns(),
        }
    }
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            format: None,
            endpoint: None,
            batch_size: None,
            interval_seconds: None,
        }
    }
}

impl Default for WebUiConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            custom_ui_path: None,
            default_page_size: default_page_size(),
            max_timeline_events: default_max_timeline_events(),
        }
    }
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: default_log_level(),
            format: default_log_format(),
            file_enabled: false,
            file_path: None,
            file_max_size_mb: None,
            file_max_backups: None,
            stdout_enabled: true,
            include_timestamps: true,
            include_modules: false,
        }
    }
}

impl Default for MetricsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: None,
            update_interval_seconds: None,
        }
    }
}

impl Default for AlertingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            alert_on_races: None,
            alert_on_anomalies: None,
            slack: None,
            pagerduty: None,
            email: None,
        }
    }
}

impl Default for DevelopmentConfig {
    fn default() -> Self {
        Self {
            dev_mode: false,
            debug_endpoints: false,
            pretty_json: false,
            request_logging: false,
            cors_allow_all: false,
        }
    }
}

impl Default for ExperimentalConfig {
    fn default() -> Self {
        Self {
            ai_anomaly_detection: false,
            auto_test_generation: false,
            deadlock_detection: false,
            distributed_tracing: true,
            realtime_streaming: false,
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            storage: StorageConfig::default(),
            engine: EngineConfig::default(),
            race_detection: RaceDetectionConfig::default(),
            anomaly_detection: AnomalyDetectionConfig::default(),
            critical_path: CriticalPathConfig::default(),
            instrumentation: InstrumentationConfig::default(),
            export: ExportConfig::default(),
            web_ui: WebUiConfig::default(),
            logging: LoggingConfig::default(),
            metrics: MetricsConfig::default(),
            alerting: AlertingConfig::default(),
            development: DevelopmentConfig::default(),
            experimental: ExperimentalConfig::default(),
        }
    }
}

impl Config {
    /// Load configuration from a TOML file
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let contents =
            std::fs::read_to_string(path.as_ref()).context("Failed to read config file")?;

        let config: Config = toml::from_str(&contents).context("Failed to parse config file")?;

        Ok(config)
    }

    /// Load configuration from a TOML file, with defaults if file doesn't exist
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

    /// Load configuration from a TOML string
    pub fn from_str(s: &str) -> Result<Self> {
        let config: Config = toml::from_str(s).context("Failed to parse config")?;

        Ok(config)
    }

    /// Get the default configuration as a TOML string
    pub fn default_toml() -> Result<String> {
        let config = Self::default();
        toml::to_string_pretty(&config).context("Failed to serialize default config")
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<()> {
        // Validate storage backend
        match self.storage.backend.as_str() {
            "memory" | "postgres" | "mysql" | "sqlite" | "supabase" => {}
            other => anyhow::bail!("Invalid storage backend: {}", other),
        }

        // Validate postgres config if backend is postgres or supabase
        // (Supabase uses postgres under the hood)
        if self.storage.backend == "postgres" || self.storage.backend == "supabase" {
            if self.storage.postgres.connection_string.is_none() {
                anyhow::bail!("Postgres/Supabase backend requires connection_string");
            }
        }

        // Validate mysql config if backend is mysql
        if self.storage.backend == "mysql" {
            if self.storage.mysql.connection_string.is_none() {
                anyhow::bail!("MySQL backend requires connection_string");
            }
        }

        // Validate sqlite config if backend is sqlite
        if self.storage.backend == "sqlite" {
            if self.storage.sqlite.database_path.is_none() {
                anyhow::bail!("SQLite backend requires database_path");
            }
        }

        // Validate port
        if self.server.port == 0 {
            anyhow::bail!("Server port cannot be 0");
        }

        // Validate sampling rate
        if self.engine.sampling_rate < 0.0 || self.engine.sampling_rate > 1.0 {
            anyhow::bail!("Sampling rate must be between 0.0 and 1.0");
        }

        // Validate confidence threshold
        if self.race_detection.confidence_threshold < 0.0
            || self.race_detection.confidence_threshold > 1.0
        {
            anyhow::bail!("Confidence threshold must be between 0.0 and 1.0");
        }

        // Validate log level
        match self.logging.level.to_lowercase().as_str() {
            "trace" | "debug" | "info" | "warn" | "error" => {}
            other => anyhow::bail!("Invalid log level: {}", other),
        }

        // Validate TLS configuration
        if self.server.tls_enabled {
            if self.server.tls_cert_path.is_none() || self.server.tls_key_path.is_none() {
                anyhow::bail!("TLS enabled but cert_path or key_path not specified");
            }
        }

        Ok(())
    }
}

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
        "#;

        let config = Config::from_str(toml_str).unwrap();
        assert_eq!(config.server.host, "0.0.0.0");
        assert_eq!(config.server.port, 3000);
        assert_eq!(config.storage.backend, "postgres");
        assert_eq!(
            config.storage.postgres.connection_string,
            Some("postgres://localhost/test".to_string())
        );
    }
}
