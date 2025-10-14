// API Response Types
export interface TracesListResponse {
  success: boolean;
  data?: {
    total_traces: number;
    total_events: number;
    trace_ids: string[];
  };
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

// UI State Types
export type ViewMode = 'events' | 'tree' | 'critical-path' | 'anomalies' | 'dependencies' | 'audit-trail';

export interface AppState {
  traces: string[];
  selectedTraceId: string | null;
  selectedEventId: string | null;
  viewMode: ViewMode;
  autoRefresh: boolean;
  loading: boolean;
  error: string | null;
}
