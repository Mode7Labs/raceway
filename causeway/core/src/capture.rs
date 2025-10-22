use crate::event::Event;
use anyhow::Result;
use crossbeam::channel::{bounded, Receiver, Sender};

/// High-performance event capture system with lock-free queues
pub struct EventCapture {
    sender: Sender<Event>,
    receiver: Receiver<Event>,
}

impl EventCapture {
    pub fn new(buffer_size: usize) -> Self {
        let (sender, receiver) = bounded(buffer_size);
        Self { sender, receiver }
    }

    /// Capture an event (non-blocking)
    pub fn capture(&self, event: Event) -> Result<()> {
        self.sender
            .try_send(event)
            .map_err(|e| anyhow::anyhow!("Failed to capture event: {}", e))
    }

    /// Get a sender handle for multi-threaded capture
    pub fn get_sender(&self) -> Sender<Event> {
        self.sender.clone()
    }

    /// Get the receiver for processing events
    pub fn get_receiver(&self) -> Receiver<Event> {
        self.receiver.clone()
    }

    /// Drain all pending events
    pub fn drain(&self) -> Vec<Event> {
        let mut events = Vec::new();
        while let Ok(event) = self.receiver.try_recv() {
            events.push(event);
        }
        events
    }
}

/// Macro for easy event capture
#[macro_export]
macro_rules! capture_event {
    ($capture:expr, $kind:expr, $trace:expr) => {{
        let metadata = EventMetadata {
            thread_id: format!("{:?}", std::thread::current().id()),
            process_id: std::process::id(),
            service_name: env!("CARGO_PKG_NAME").to_string(),
            environment: std::env::var("ENV").unwrap_or_else(|_| "development".to_string()),
            tags: std::collections::HashMap::new(),
            duration_ns: None,
        };
        let event = Event::new($kind, metadata, $trace.trace_id, $trace.current_span_id);
        $capture.capture(event)
    }};
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::EventKind;
    use crate::event::EventMetadata;
    use std::collections::HashMap;
    use uuid::Uuid;

    #[test]
    fn test_event_capture() {
        let capture = EventCapture::new(1000);
        let trace_id = Uuid::new_v4();

        let metadata = EventMetadata {
            thread_id: "main".to_string(),
            process_id: 1234,
            service_name: "test".to_string(),
            environment: "dev".to_string(),
            tags: HashMap::new(),
            duration_ns: None,
            instance_id: None,
            distributed_span_id: None,
            upstream_span_id: None,
        };

        let event = Event::new(
            EventKind::Custom {
                name: "test".to_string(),
                data: serde_json::json!({}),
            },
            metadata,
            trace_id,
            None,
        );

        assert!(capture.capture(event).is_ok());
        let events = capture.drain();
        assert_eq!(events.len(), 1);
    }
}
