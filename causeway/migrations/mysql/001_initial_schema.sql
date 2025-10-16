-- Raceway MySQL Database Schema
-- This schema stores all causal graph events, traces, and race detection data

-- =============================================================================
-- Events Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS events (
    id CHAR(36) PRIMARY KEY,
    trace_id CHAR(36) NOT NULL,
    parent_id CHAR(36),
    timestamp DATETIME(6) NOT NULL,
    kind JSON NOT NULL,
    metadata JSON NOT NULL,
    causality_vector JSON,
    lock_set JSON,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_events_trace_id (trace_id),
    INDEX idx_events_timestamp (timestamp),
    INDEX idx_events_parent_id (parent_id),
    INDEX idx_events_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Causal Edges Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS causal_edges (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    from_event_id CHAR(36) NOT NULL,
    to_event_id CHAR(36) NOT NULL,
    edge_type VARCHAR(50) NOT NULL,
    weight INT DEFAULT 1,
    metadata JSON,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE KEY unique_edge (from_event_id, to_event_id),
    INDEX idx_causal_edges_from (from_event_id),
    INDEX idx_causal_edges_to (to_event_id),

    FOREIGN KEY (from_event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (to_event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Trace Roots Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS trace_roots (
    trace_id CHAR(36) NOT NULL,
    root_event_id CHAR(36) NOT NULL,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),

    PRIMARY KEY (trace_id, root_event_id),
    INDEX idx_trace_roots_trace_id (trace_id),

    FOREIGN KEY (root_event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Baseline Metrics Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS baseline_metrics (
    operation VARCHAR(255) PRIMARY KEY,
    count BIGINT NOT NULL DEFAULT 0,
    total_duration_micros BIGINT NOT NULL DEFAULT 0,
    min_duration_micros BIGINT NOT NULL,
    max_duration_micros BIGINT NOT NULL,
    mean_duration_micros DOUBLE NOT NULL,
    variance DOUBLE NOT NULL,
    std_dev DOUBLE NOT NULL,
    updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Cross-Trace Index Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS cross_trace_index (
    variable VARCHAR(255) NOT NULL,
    event_id CHAR(36) NOT NULL,
    trace_id CHAR(36) NOT NULL,
    timestamp DATETIME(6) NOT NULL,
    thread_id VARCHAR(255) NOT NULL,
    access_type VARCHAR(50) NOT NULL,
    value JSON,
    location TEXT,

    PRIMARY KEY (variable, event_id),
    INDEX idx_cross_trace_variable (variable),
    INDEX idx_cross_trace_trace_id (trace_id),
    INDEX idx_cross_trace_timestamp (timestamp),

    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Anomalies Cache Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS anomalies (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    trace_id CHAR(36) NOT NULL,
    event_id CHAR(36) NOT NULL,
    event_kind VARCHAR(255) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    actual_duration_ms DOUBLE NOT NULL,
    expected_duration_ms DOUBLE NOT NULL,
    std_dev_from_mean DOUBLE NOT NULL,
    description TEXT,
    location TEXT,
    timestamp DATETIME(6) NOT NULL,
    detected_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_anomalies_trace_id (trace_id),
    INDEX idx_anomalies_severity (severity),

    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
