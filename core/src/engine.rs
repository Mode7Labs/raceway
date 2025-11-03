use crate::analysis::AnalysisService;
use crate::capture::EventCapture;
use crate::config::Config;
use crate::storage::StorageBackend;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::task;

/// Main engine that coordinates event capture and graph building
pub struct RacewayEngine {
    capture: Arc<EventCapture>,
    storage: Arc<dyn StorageBackend>,
    analysis: Arc<AnalysisService>,
    config: EngineConfig,
    running: Arc<RwLock<bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    pub buffer_size: usize,
    pub batch_size: usize,
    pub flush_interval_ms: u64,
    pub enable_anomaly_detection: bool,
    pub enable_race_detection: bool,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            buffer_size: 10000,
            batch_size: 100,
            flush_interval_ms: 100,
            enable_anomaly_detection: true,
            enable_race_detection: true,
        }
    }
}

impl RacewayEngine {
    pub async fn new(
        config: EngineConfig,
        storage: Arc<dyn StorageBackend>,
        full_config: Config,
    ) -> Result<Self> {
        let capture = Arc::new(EventCapture::new(config.buffer_size));

        // Create AnalysisService with the storage backend and full config
        let analysis = Arc::new(AnalysisService::new(Arc::clone(&storage), full_config).await?);

        Ok(Self {
            capture,
            storage,
            analysis,
            config,
            running: Arc::new(RwLock::new(false)),
        })
    }

    /// Start the engine
    pub async fn start(&self) -> Result<()> {
        let mut running = self.running.write().await;
        if *running {
            return Ok(());
        }
        *running = true;
        drop(running);

        // Spawn event processing task
        let capture = Arc::clone(&self.capture);
        let analysis = Arc::clone(&self.analysis);
        let config = self.config.clone();
        let running = Arc::clone(&self.running);

        task::spawn(async move {
            Self::process_events(capture, analysis, config, running).await;
        });

        Ok(())
    }

    /// Stop the engine
    pub async fn stop(&self) {
        let mut running = self.running.write().await;
        *running = false;
    }

    /// Process events and build the causal graph
    async fn process_events(
        capture: Arc<EventCapture>,
        analysis: Arc<AnalysisService>,
        config: EngineConfig,
        running: Arc<RwLock<bool>>,
    ) {
        let receiver = capture.get_receiver();

        loop {
            {
                let is_running = running.read().await;
                if !*is_running {
                    break;
                }
            }

            // Batch process events
            let mut batch = Vec::with_capacity(config.batch_size);
            for _ in 0..config.batch_size {
                match receiver.try_recv() {
                    Ok(event) => batch.push(event),
                    Err(_) => break,
                }
            }

            // Add events to analysis service (which persists to storage and updates graph)
            for event in batch {
                if let Err(e) = analysis.add_event(event).await {
                    eprintln!("Failed to add event: {}", e);
                }
            }

            // Sleep briefly to avoid spinning
            tokio::time::sleep(tokio::time::Duration::from_millis(config.flush_interval_ms)).await;
        }
    }

    /// Get the event capture interface
    pub fn capture(&self) -> Arc<EventCapture> {
        Arc::clone(&self.capture)
    }

    /// Get the storage backend
    pub fn storage(&self) -> Arc<dyn StorageBackend> {
        Arc::clone(&self.storage)
    }

    /// Get the analysis service
    pub fn analysis(&self) -> Arc<AnalysisService> {
        Arc::clone(&self.analysis)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::StorageConfig;
    use crate::storage::MemoryBackend;

    #[tokio::test]
    async fn test_engine_start_stop() {
        let engine_config = EngineConfig::default();
        let storage_config = StorageConfig::default();
        let storage = Arc::new(MemoryBackend::new(&storage_config).unwrap());
        let full_config = Config::default();
        let engine = RacewayEngine::new(engine_config, storage, full_config)
            .await
            .unwrap();

        assert!(engine.start().await.is_ok());
        engine.stop().await;
    }
}
