use crate::capture::EventCapture;
use crate::graph::CausalGraph;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::task;
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Main engine that coordinates event capture and graph building
pub struct RacewayEngine {
    capture: Arc<EventCapture>,
    graph: Arc<CausalGraph>,
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
    pub fn new(config: EngineConfig) -> Self {
        let capture = Arc::new(EventCapture::new(config.buffer_size));
        let graph = Arc::new(CausalGraph::new());

        Self {
            capture,
            graph,
            config,
            running: Arc::new(RwLock::new(false)),
        }
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
        let graph = Arc::clone(&self.graph);
        let config = self.config.clone();
        let running = Arc::clone(&self.running);

        task::spawn(async move {
            Self::process_events(capture, graph, config, running).await;
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
        graph: Arc<CausalGraph>,
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

            // Add events to graph
            for event in batch {
                if let Err(e) = graph.add_event(event) {
                    eprintln!("Failed to add event to graph: {}", e);
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

    /// Get the causal graph
    pub fn graph(&self) -> Arc<CausalGraph> {
        Arc::clone(&self.graph)
    }

    /// Export the graph to JSON
    pub fn export_json(&self) -> Result<String> {
        let stats = self.graph.stats();
        serde_json::to_string_pretty(&stats)
            .map_err(|e| anyhow::anyhow!("Failed to export graph: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_engine_start_stop() {
        let config = EngineConfig::default();
        let engine = RacewayEngine::new(config);

        assert!(engine.start().await.is_ok());
        engine.stop().await;
    }
}
