use std::cell::RefCell;

tokio::task_local! {
    pub static RACEWAY_CONTEXT: RefCell<RacewayContext>;
}

// Context that propagates through async tasks
#[derive(Clone, Debug)]
pub struct RacewayContext {
    pub trace_id: String,
    pub parent_id: Option<String>,
    pub root_id: Option<String>,
    pub clock: u64,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub distributed: bool,
    pub clock_vector: Vec<(String, u64)>,
    pub tracestate: Option<String>,
    pub service_name: String,
    pub instance_id: String,
}

impl RacewayContext {
    pub fn new(trace_id: String, service_name: String, instance_id: String) -> Self {
        let component = format!("{}#{}", service_name, instance_id);
        let span_source = uuid::Uuid::new_v4().to_string().replace('-', "");
        let span_id: String = span_source.chars().take(16).collect();

        Self {
            trace_id,
            parent_id: None,
            root_id: None,
            clock: 0,
            span_id,
            parent_span_id: None,
            distributed: false,
            clock_vector: vec![(component, 0)],
            tracestate: None,
            service_name,
            instance_id,
        }
    }

    pub fn with_parent(mut self, parent_id: String, root_id: String, clock: u64) -> Self {
        self.parent_id = Some(parent_id);
        self.root_id = Some(root_id);
        self.clock = clock;
        self
    }
}
