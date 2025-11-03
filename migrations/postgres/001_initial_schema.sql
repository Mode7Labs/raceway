-- Raceway PostgreSQL Database Schema
-- This schema stores all causal graph events, traces, and race detection data

-- =============================================================================
-- Events Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY,
    trace_id UUID NOT NULL,
    parent_id UUID,
    timestamp TIMESTAMPTZ NOT NULL,
    kind JSONB NOT NULL,  -- EventKind enum serialized as JSON
    metadata JSONB NOT NULL,  -- EventMetadata serialized as JSON
    causality_vector JSONB,  -- Vector<(Uuid, u64)> for happens-before tracking
    lock_set JSONB,  -- Vec<String> of locks held at event time
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_parent_id ON events(parent_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

-- GIN index for JSONB queries (searching within event kinds, metadata)
CREATE INDEX IF NOT EXISTS idx_events_kind_gin ON events USING GIN (kind);
CREATE INDEX IF NOT EXISTS idx_events_metadata_gin ON events USING GIN (metadata);

-- =============================================================================
-- Causal Edges Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS causal_edges (
    id SERIAL PRIMARY KEY,
    from_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    to_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    edge_type VARCHAR(50) NOT NULL,  -- "DirectCall", "AsyncSpawn", "DataDependency", etc.
    weight INTEGER DEFAULT 1,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(from_event_id, to_event_id)
);

CREATE INDEX IF NOT EXISTS idx_causal_edges_from ON causal_edges(from_event_id);
CREATE INDEX IF NOT EXISTS idx_causal_edges_to ON causal_edges(to_event_id);

-- =============================================================================
-- Trace Roots Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS trace_roots (
    trace_id UUID NOT NULL,
    root_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (trace_id, root_event_id)
);

CREATE INDEX IF NOT EXISTS idx_trace_roots_trace_id ON trace_roots(trace_id);

-- =============================================================================
-- Baseline Metrics Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS baseline_metrics (
    operation VARCHAR(255) PRIMARY KEY,
    count BIGINT NOT NULL DEFAULT 0,
    total_duration_micros BIGINT NOT NULL DEFAULT 0,
    min_duration_micros BIGINT NOT NULL,
    max_duration_micros BIGINT NOT NULL,
    mean_duration_micros DOUBLE PRECISION NOT NULL,
    variance DOUBLE PRECISION NOT NULL,
    std_dev DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Cross-Trace Index Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS cross_trace_index (
    variable VARCHAR(255) NOT NULL,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    trace_id UUID NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    thread_id VARCHAR(255) NOT NULL,
    access_type VARCHAR(50) NOT NULL,  -- "Read", "Write", "AtomicRead", etc.
    value JSONB,
    location TEXT,

    PRIMARY KEY (variable, event_id)
);

CREATE INDEX IF NOT EXISTS idx_cross_trace_variable ON cross_trace_index(variable);
CREATE INDEX IF NOT EXISTS idx_cross_trace_trace_id ON cross_trace_index(trace_id);
CREATE INDEX IF NOT EXISTS idx_cross_trace_timestamp ON cross_trace_index(timestamp);

-- =============================================================================
-- Anomalies Cache Table (optional - for caching detected anomalies)
-- =============================================================================
CREATE TABLE IF NOT EXISTS anomalies (
    id SERIAL PRIMARY KEY,
    trace_id UUID NOT NULL,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    event_kind VARCHAR(255) NOT NULL,
    severity VARCHAR(50) NOT NULL,  -- "Minor", "Warning", "Critical"
    actual_duration_ms DOUBLE PRECISION NOT NULL,
    expected_duration_ms DOUBLE PRECISION NOT NULL,
    std_dev_from_mean DOUBLE PRECISION NOT NULL,
    description TEXT,
    location TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_trace_id ON anomalies(trace_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity);

-- =============================================================================
-- Helper Views
-- =============================================================================

-- View for quickly finding StateChange events
CREATE OR REPLACE VIEW state_change_events AS
SELECT
    id,
    trace_id,
    timestamp,
    kind->>'variable' AS variable,
    kind->>'access_type' AS access_type,
    kind->'new_value' AS new_value,
    kind->'old_value' AS old_value,
    kind->>'location' AS location,
    metadata->>'thread_id' AS thread_id,
    metadata->>'service_name' AS service_name
FROM events
WHERE kind->>'StateChange' IS NOT NULL
   OR (kind::text LIKE '%StateChange%');

-- View for trace statistics
CREATE OR REPLACE VIEW trace_stats AS
SELECT
    trace_id,
    COUNT(*) as event_count,
    MIN(timestamp) as start_time,
    MAX(timestamp) as end_time,
    EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) * 1000 as duration_ms,
    COUNT(DISTINCT metadata->>'thread_id') as thread_count,
    COUNT(DISTINCT metadata->>'service_name') as service_count
FROM events
GROUP BY trace_id;

-- =============================================================================
-- Functions for common operations
-- =============================================================================

-- Function to cleanup old traces beyond retention period
CREATE OR REPLACE FUNCTION cleanup_old_traces(retention_hours INTEGER)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    WITH deleted AS (
        DELETE FROM events
        WHERE created_at < NOW() - (retention_hours || ' hours')::INTERVAL
        RETURNING trace_id
    )
    SELECT COUNT(DISTINCT trace_id) INTO deleted_count FROM deleted;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to find concurrent state changes to the same variable
CREATE OR REPLACE FUNCTION find_variable_races(var_name VARCHAR)
RETURNS TABLE (
    event1_id UUID,
    event1_trace_id UUID,
    event1_timestamp TIMESTAMPTZ,
    event1_thread_id TEXT,
    event2_id UUID,
    event2_trace_id UUID,
    event2_timestamp TIMESTAMPTZ,
    event2_thread_id TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e1.id as event1_id,
        e1.trace_id as event1_trace_id,
        e1.timestamp as event1_timestamp,
        e1.metadata->>'thread_id' as event1_thread_id,
        e2.id as event2_id,
        e2.trace_id as event2_trace_id,
        e2.timestamp as event2_timestamp,
        e2.metadata->>'thread_id' as event2_thread_id
    FROM
        cross_trace_index cti1
    JOIN
        cross_trace_index cti2 ON cti1.variable = cti2.variable
    JOIN
        events e1 ON cti1.event_id = e1.id
    JOIN
        events e2 ON cti2.event_id = e2.id
    WHERE
        cti1.variable = var_name
        AND cti1.event_id < cti2.event_id  -- Avoid duplicates
        AND cti1.thread_id != cti2.thread_id  -- Different threads
        AND (cti1.access_type = 'Write' OR cti2.access_type = 'Write')  -- At least one write
        AND ABS(EXTRACT(EPOCH FROM (e1.timestamp - e2.timestamp))) < 1.0;  -- Within 1 second
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Initial Data / Comments
-- =============================================================================

COMMENT ON TABLE events IS 'Stores all captured events from distributed traces';
COMMENT ON TABLE causal_edges IS 'Represents causal relationships (happens-before) between events';
COMMENT ON TABLE trace_roots IS 'Maps traces to their root (entry point) events';
COMMENT ON TABLE baseline_metrics IS 'Stores performance baselines for anomaly detection';
COMMENT ON TABLE cross_trace_index IS 'Optimized index for cross-trace race detection on shared variables';
COMMENT ON TABLE anomalies IS 'Cache of detected anomalies to avoid recomputation';

COMMENT ON COLUMN events.causality_vector IS 'Vector clock for happens-before relationship tracking';
COMMENT ON COLUMN events.lock_set IS 'Locks held by the thread at the time of this event';
COMMENT ON COLUMN events.kind IS 'Event type and associated data (FunctionCall, StateChange, LockAcquire, etc.)';
COMMENT ON COLUMN events.metadata IS 'Thread ID, service name, tags, duration, etc.';
