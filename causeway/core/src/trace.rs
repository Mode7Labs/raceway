use std::sync::Arc;
use tokio::task_local;
use uuid::Uuid;

/// Trace context for tracking causality across async boundaries
#[derive(Debug, Clone)]
pub struct TraceContext {
    pub trace_id: Uuid,
    pub current_span_id: Option<Uuid>,
    pub vector_clock: Vec<(Uuid, u64)>,
}

impl TraceContext {
    pub fn new() -> Self {
        Self {
            trace_id: Uuid::new_v4(),
            current_span_id: None,
            vector_clock: Vec::new(),
        }
    }

    pub fn with_trace_id(trace_id: Uuid) -> Self {
        Self {
            trace_id,
            current_span_id: None,
            vector_clock: Vec::new(),
        }
    }

    pub fn new_span(&mut self) -> Uuid {
        let span_id = Uuid::new_v4();
        self.current_span_id = Some(span_id);

        // Increment vector clock
        if let Some(pos) = self.vector_clock.iter().position(|(id, _)| id == &span_id) {
            self.vector_clock[pos].1 += 1;
        } else {
            self.vector_clock.push((span_id, 1));
        }

        span_id
    }

    pub fn merge_clock(&mut self, other: &[(Uuid, u64)]) {
        for (other_id, other_clock) in other {
            if let Some(pos) = self.vector_clock.iter().position(|(id, _)| id == other_id) {
                self.vector_clock[pos].1 = self.vector_clock[pos].1.max(*other_clock);
            } else {
                self.vector_clock.push((*other_id, *other_clock));
            }
        }
    }
}

impl Default for TraceContext {
    fn default() -> Self {
        Self::new()
    }
}

task_local! {
    pub static TRACE_CONTEXT: Arc<std::sync::Mutex<TraceContext>>;
}

/// Get or create trace context for the current async task
pub fn get_or_create_trace_context() -> TraceContext {
    TRACE_CONTEXT
        .try_with(|ctx| ctx.lock().unwrap().clone())
        .unwrap_or_else(|_| TraceContext::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trace_context() {
        let mut ctx = TraceContext::new();
        let span1 = ctx.new_span();
        let span2 = ctx.new_span();

        assert_ne!(span1, span2);
        assert_eq!(ctx.current_span_id, Some(span2));
    }

    #[test]
    fn test_vector_clock_merge() {
        let mut ctx1 = TraceContext::new();
        let span1 = ctx1.new_span();

        let mut ctx2 = TraceContext::new();
        let span2 = ctx2.new_span();

        ctx1.merge_clock(&ctx2.vector_clock);

        assert_eq!(ctx1.vector_clock.len(), 2);
    }
}
