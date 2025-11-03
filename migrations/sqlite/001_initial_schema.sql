-- Raceway SQLite Database Schema
-- This schema stores all causal graph events, traces, and race detection data

-- =============================================================================
-- Events Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    parent_id TEXT,
    timestamp TEXT NOT NULL,  -- ISO 8601 format
    kind TEXT NOT NULL,  -- JSON serialized EventKind
    metadata TEXT NOT NULL,  -- JSON serialized EventMetadata
    causality_vector TEXT,  -- JSON serialized vector clock
    lock_set TEXT,  -- JSON serialized lock set
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_parent_id ON events(parent_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

-- =============================================================================
-- Causal Edges Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS causal_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_event_id TEXT NOT NULL,
    to_event_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    weight INTEGER DEFAULT 1,
    metadata TEXT,  -- JSON
    created_at TEXT DEFAULT (datetime('now')),

    UNIQUE(from_event_id, to_event_id),
    FOREIGN KEY (from_event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (to_event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_causal_edges_from ON causal_edges(from_event_id);
CREATE INDEX IF NOT EXISTS idx_causal_edges_to ON causal_edges(to_event_id);

-- =============================================================================
-- Trace Roots Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS trace_roots (
    trace_id TEXT NOT NULL,
    root_event_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),

    PRIMARY KEY (trace_id, root_event_id),
    FOREIGN KEY (root_event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trace_roots_trace_id ON trace_roots(trace_id);

-- =============================================================================
-- Baseline Metrics Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS baseline_metrics (
    operation TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    total_duration_micros INTEGER NOT NULL DEFAULT 0,
    min_duration_micros INTEGER NOT NULL,
    max_duration_micros INTEGER NOT NULL,
    mean_duration_micros REAL NOT NULL,
    variance REAL NOT NULL,
    std_dev REAL NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- Cross-Trace Index Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS cross_trace_index (
    variable TEXT NOT NULL,
    event_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    access_type TEXT NOT NULL,
    value TEXT,  -- JSON
    location TEXT,

    PRIMARY KEY (variable, event_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cross_trace_variable ON cross_trace_index(variable);
CREATE INDEX IF NOT EXISTS idx_cross_trace_trace_id ON cross_trace_index(trace_id);
CREATE INDEX IF NOT EXISTS idx_cross_trace_timestamp ON cross_trace_index(timestamp);

-- =============================================================================
-- Anomalies Cache Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    actual_duration_ms REAL NOT NULL,
    expected_duration_ms REAL NOT NULL,
    std_dev_from_mean REAL NOT NULL,
    description TEXT,
    location TEXT,
    timestamp TEXT NOT NULL,
    detected_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_anomalies_trace_id ON anomalies(trace_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity);

-- =============================================================================
-- Enable Foreign Keys (required for SQLite)
-- =============================================================================
PRAGMA foreign_keys = ON;

-- =============================================================================
-- Enable WAL mode for better concurrent access
-- =============================================================================
PRAGMA journal_mode = WAL;
