-- Migration 003: Distributed Tracing Support (Phase 2)
-- Creates tables for tracking distributed spans and cross-service edges

-- Distributed Spans Table
-- Tracks spans across multiple services in a distributed trace
CREATE TABLE IF NOT EXISTS distributed_spans (
    trace_id UUID NOT NULL,
    span_id TEXT PRIMARY KEY,
    service TEXT NOT NULL,
    instance TEXT NOT NULL,
    first_event TIMESTAMPTZ NOT NULL,
    last_event TIMESTAMPTZ,
    span_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Distributed Edges Table
-- Links between spans representing cross-service calls
CREATE TABLE IF NOT EXISTS distributed_edges (
    from_span TEXT NOT NULL,
    to_span TEXT NOT NULL,
    link_type TEXT NOT NULL,
    edge_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (from_span, to_span)
);

-- Indexes for distributed tracing queries
CREATE INDEX IF NOT EXISTS idx_distributed_spans_trace_id ON distributed_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_distributed_spans_service ON distributed_spans(service);
CREATE INDEX IF NOT EXISTS idx_distributed_spans_first_event ON distributed_spans(first_event);
CREATE INDEX IF NOT EXISTS idx_distributed_edges_from_span ON distributed_edges(from_span);
CREATE INDEX IF NOT EXISTS idx_distributed_edges_to_span ON distributed_edges(to_span);
