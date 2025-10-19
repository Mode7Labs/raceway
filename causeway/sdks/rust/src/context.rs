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
}

impl RacewayContext {
    pub fn new(trace_id: String) -> Self {
        Self {
            trace_id,
            parent_id: None,
            root_id: None,
            clock: 0,
        }
    }

    pub fn with_parent(mut self, parent_id: String, root_id: String, clock: u64) -> Self {
        self.parent_id = Some(parent_id);
        self.root_id = Some(root_id);
        self.clock = clock;
        self
    }
}
