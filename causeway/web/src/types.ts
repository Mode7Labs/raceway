// API Response Types
export interface TracesListResponse {
  success: boolean;
  data?: {
    total_traces: number;
    page: number;
    page_size: number;
    total_pages: number;
    traces: TraceMetadata[];
  };
}

export interface TraceMetadata {
  trace_id: string;
  event_count: number;
  first_timestamp: string;
  last_timestamp: string;
  service_count: number;
  services: string[];
}

export interface TraceResponse {
  success: boolean;
  data?: {
    trace_id: string;
    event_count: number;
    events: Event[];
  };
}

export interface AnalysisResponse {
  success: boolean;
  data?: {
    trace_id: string;
    concurrent_events: number;
    potential_races: number;
    anomalies: string[];
    race_details?: RaceDetail[];
  };
}

export interface CriticalPathResponse {
  success: boolean;
  data?: CriticalPathData;
}

export interface AnomaliesResponse {
  success: boolean;
  data?: AnomaliesData;
}

export interface FullTraceAnalysisResponse {
  success: boolean;
  data?: FullTraceAnalysisData;
}

export interface FullTraceAnalysisData {
  trace_id: string;
  events: Event[];
  audit_trails: Record<string, VariableAccess[]>;
  analysis: {
    concurrent_events: number;
    potential_races: number;
    anomalies: string[];
    race_details: RaceDetail[];
  };
  critical_path: CriticalPathData | null;
  anomalies: DetectedAnomaly[];
  dependencies: DependenciesData | null;
}

// Data Types
export interface Event {
  id: string;
  trace_id: string;
  parent_id: string | null;
  timestamp: string;
  kind: Record<string, any>;
  metadata: EventMetadata;
  causality_vector: Array<[string, number]>;
  lock_set: string[];
}

export interface EventMetadata {
  thread_id: string;
  process_id: number;
  service_name: string;
  environment: string;
  tags: Record<string, string>;
  duration_ns: number | null;
  location?: string;
}

export interface RaceDetail {
  severity: string;
  variable: string;
  event1_thread: string;
  event2_thread: string;
  event1_location: string;
  event2_location: string;
  description: string;
}

export interface CriticalPathData {
  trace_id: string;
  path_events: number;
  total_duration_ms: number;
  trace_total_duration_ms: number;
  percentage_of_total: number;
  path: PathEvent[];
}

export interface PathEvent {
  id: string;
  kind: string;
  location: string;
  timestamp: string;
  duration_ms: number;
}

export interface AnomaliesData {
  trace_id: string;
  anomaly_count: number;
  anomalies: DetectedAnomaly[];
}

export interface DetectedAnomaly {
  event_id: string;
  event_kind: string;
  severity: 'Minor' | 'Warning' | 'Critical';
  actual_duration_ms: number;
  expected_duration_ms: number;
  std_dev_from_mean: number;
  description: string;
  location: string;
  timestamp: string;
}

// Dependencies response types
export interface DependenciesResponse {
  success: boolean;
  data?: DependenciesData;
}

export interface DependenciesData {
  trace_id: string;
  services: ServiceInfo[];
  dependencies: ServiceDependency[];
}

export interface ServiceInfo {
  name: string;
  event_count: number;
}

export interface ServiceDependency {
  from: string;
  to: string;
  call_count: number;
}

// Audit trail response types
export interface AuditTrailResponse {
  success: boolean;
  data?: AuditTrailData;
}

export interface AuditTrailData {
  trace_id: string;
  variable: string;
  accesses: VariableAccess[];
}

export interface VariableAccess {
  event_id: string;
  timestamp: string;
  thread_id: string;
  service_name: string;
  access_type: string;
  old_value: any | null;
  new_value: any;
  location: string;
  has_causal_link_to_previous: boolean;
  is_race: boolean;
}

// Global analysis response types (extends AnalysisResponse)
export interface GlobalAnalysisResponse {
  success: boolean;
  data?: GlobalAnalysisData;
}

export interface GlobalAnalysisData {
  total_traces: number;
  total_events: number;
  concurrent_events: number;
  potential_races: number;
  anomalies: string[];
  race_details?: GlobalRaceDetail[];
}

export interface GlobalRaceDetail {
  severity: string;
  variable: string;
  trace1_id: string;
  trace2_id: string;
  event1_thread: string;
  event2_thread: string;
  event1_location: string;
  event2_location: string;
  event1_timestamp: string;
  event2_timestamp: string;
  description: string;
}

// Distributed trace analysis response types
export interface DistributedTraceAnalysisResponse {
  success: boolean;
  data?: DistributedTraceAnalysisData;
}

export interface DistributedTraceAnalysisData {
  trace_id: string;
  service_breakdown: ServiceBreakdown;
  critical_path: CriticalPathSummary | null;
  race_conditions: RaceConditionSummary;
  is_distributed: boolean;
}

export interface ServiceBreakdown {
  services: ServiceStats[];
  cross_service_calls: number;
  total_services: number;
}

export interface ServiceStats {
  name: string;
  event_count: number;
  total_duration_ms: number;
}

export interface CriticalPathSummary {
  total_duration_ms: number;
  trace_total_duration_ms: number;
  percentage_of_total: number;
  path_events: number;
}

export interface RaceConditionSummary {
  total_races: number;
  critical_races: number;
  warning_races: number;
}

// Services catalog response types
export interface ServicesListResponse {
  success: boolean;
  data?: {
    total_services: number;
    services: ServiceListItem[];
  };
}

export interface ServiceListItem {
  name: string;
  event_count: number;
  trace_count: number;
}

export interface ServiceDependenciesResponse {
  success: boolean;
  data?: ServiceDependenciesData;
}

export interface ServiceDependenciesData {
  service_name: string;
  calls_to: ServiceDependencyInfo[];
  called_by: ServiceDependencyInfo[];
}

export interface ServiceDependencyInfo {
  to: string;
  total_calls: number;
  trace_count: number;
}

// UI State Types
export type SidebarMode = 'system' | 'traces';
export type SystemViewMode = 'insights' | 'services';
export type InsightsViewMode = 'dashboard' | 'dependency-graph' | 'performance' | 'health' | 'hotspots' | 'races';
export type ViewMode = 'overview' | 'events' | 'performance' | 'variables' | 'anomalies';
export type ServiceViewMode = 'overview' | 'traces' | 'dependencies' | 'performance';

export interface AppState {
  traces: string[];
  selectedTraceId: string | null;
  selectedEventId: string | null;
  selectedServiceName: string | null;
  viewMode: ViewMode;
  serviceViewMode: ServiceViewMode;
  sidebarMode: SidebarMode;
  autoRefresh: boolean;
  loading: boolean;
  error: string | null;
}

// Distributed system analysis types
export interface DistributedEdgesResponse {
  success: boolean;
  data?: {
    total_edges: number;
    edges: DistributedEdge[];
  };
}

export interface DistributedEdge {
  from_service: string;
  to_service: string;
  link_type: string;
  call_count: number;
}

export interface GlobalRacesResponse {
  success: boolean;
  data?: {
    total_races: number;
    races: GlobalRace[];
  };
}

export interface GlobalRace {
  variable: string;
  trace_count: number;
  access_count: number;
  access_types: string[];
  thread_count: number;
  severity: string;
  trace_ids: string[];
}

export interface SystemHotspotsResponse {
  success: boolean;
  data?: {
    top_variables: VariableHotspot[];
    top_service_calls: ServiceCallHotspot[];
  };
}

export interface VariableHotspot {
  variable: string;
  access_count: number;
  trace_count: number;
  services: string[];
}

export interface ServiceCallHotspot {
  from_service: string;
  to_service: string;
  call_count: number;
}

// Service Health Response
export interface ServiceHealthResponse {
  success: boolean;
  data?: ServiceHealth[];
}

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'warning' | 'critical';
  trace_count: number;
  last_activity: string;
  avg_events_per_trace: number;
  minutes_since_last_activity: number;
}

// Service Traces Response
export interface ServiceTracesResponse {
  success: boolean;
  data?: {
    service_name: string;
    total_traces: number;
    page: number;
    page_size: number;
    total_pages: number;
    traces: TraceMetadata[];
  };
}

// Performance Metrics Response
export interface PerformanceMetricsResponse {
  success: boolean;
  data?: PerformanceMetrics;
}

export interface PerformanceMetrics {
  trace_latency: {
    avg_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    slowest_traces: SlowTrace[];
  };
  event_performance: {
    by_type: EventTypePerformance[];
  };
  service_latency: ServiceLatency[];
  throughput: {
    events_per_second: number;
    traces_per_second: number;
    time_range_seconds: number;
  };
}

export interface SlowTrace {
  trace_id: string;
  duration_ms: number;
  services: string[];
}

export interface EventTypePerformance {
  type: string;
  count: number;
  avg_duration_ms: number;
}

export interface ServiceLatency {
  service: string;
  event_count: number;
  avg_duration_ms: number;
}

// Lock contention analysis types
export interface LockEvent {
  lock_id: string;
  lock_type: string;
  thread_id: string;
  service_name: string;
  event_id: string;
  timestamp: number;
  location: string;
  is_acquire: boolean; // true = acquire, false = release
  event: Event;
}

export interface LockHold {
  lock_id: string;
  thread_id: string;
  acquire_time: number;
  release_time: number | null; // null if still held
  duration: number;
  acquire_event: Event;
  release_event: Event | null;
}

export interface LockContention {
  lock_id: string;
  blocked_thread: string;
  blocking_thread: string;
  wait_start: number;
  wait_end: number;
  wait_duration: number;
  blocked_event: Event;
}

export interface LockMetrics {
  lock_id: string;
  total_acquisitions: number;
  total_hold_time: number;
  avg_hold_time: number;
  max_hold_time: number;
  contention_count: number;
  avg_wait_time: number;
  max_wait_time: number;
  threads: string[];
}
