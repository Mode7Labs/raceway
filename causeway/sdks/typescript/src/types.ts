/**
 * Core types for Raceway SDK
 */

export type UUID = string;

/**
 * Event kinds that Raceway can capture
 */
export enum EventKind {
  FunctionCall = 'FunctionCall',
  StateChange = 'StateChange',
  AsyncSpawn = 'AsyncSpawn',
  AsyncAwait = 'AsyncAwait',
  HttpRequest = 'HttpRequest',
  HttpResponse = 'HttpResponse',
  DatabaseQuery = 'DatabaseQuery',
  DatabaseResult = 'DatabaseResult',
  Error = 'Error',
  Custom = 'Custom',
}

/**
 * Function call event
 */
export interface FunctionCallEvent {
  function_name: string;
  module: string;
  args: Record<string, any>;
  file: string;
  line: number;
}

/**
 * State change event (variable read/write)
 */
export interface StateChangeEvent {
  variable: string;
  old_value: any | null;
  new_value: any;
  location: string;
  access_type: 'Read' | 'Write';
}

/**
 * Async spawn event (new task/promise created)
 */
export interface AsyncSpawnEvent {
  task_id: UUID;
  spawned_by: string;
}

/**
 * Async await event (waiting for promise)
 */
export interface AsyncAwaitEvent {
  future_id: UUID;
  awaited_at: string;
}

/**
 * HTTP request event
 */
export interface HttpRequestEvent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
}

/**
 * HTTP response event
 */
export interface HttpResponseEvent {
  status: number;
  headers: Record<string, string>;
  body?: any;
  duration_ms: number;
}

/**
 * Database query event
 */
export interface DatabaseQueryEvent {
  query: string;
  database: string;
  duration_ms: number;
}

/**
 * Database result event
 */
export interface DatabaseResultEvent {
  rows_affected: number;
}

/**
 * Error event
 */
export interface ErrorEvent {
  error_type: string;
  message: string;
  stack_trace: string[];
}

/**
 * Custom event (user-defined)
 */
export interface CustomEvent {
  name: string;
  data: Record<string, any>;
}

/**
 * Union type for all event data
 */
export type EventData =
  | { FunctionCall: FunctionCallEvent }
  | { StateChange: StateChangeEvent }
  | { AsyncSpawn: AsyncSpawnEvent }
  | { AsyncAwait: AsyncAwaitEvent }
  | { HttpRequest: HttpRequestEvent }
  | { HttpResponse: HttpResponseEvent }
  | { DatabaseQuery: DatabaseQueryEvent }
  | { DatabaseResult: DatabaseResultEvent }
  | { Error: ErrorEvent }
  | { Custom: CustomEvent };

/**
 * Event metadata
 */
export interface EventMetadata {
  thread_id: string;
  process_id: number;
  service_name: string;
  environment: string;
  tags: Record<string, string>;
  duration_ns: number | null;
  // Phase 2: Distributed tracing fields
  instance_id?: string | null;
  distributed_span_id?: string | null;
  upstream_span_id?: string | null;
}

/**
 * Complete event structure
 */
export interface Event {
  id: UUID;
  trace_id: UUID;
  parent_id: UUID | null;
  timestamp: string;
  kind: EventData;
  metadata: EventMetadata;
  causality_vector: Array<[UUID, number]>;
  lock_set: string[];  // Locks held by the thread at the time of this event
}

/**
 * Configuration for Raceway SDK
 */
export interface RacewayConfig {
  /** URL of the Raceway server */
  serverUrl: string;

  /** API key for authenticated servers */
  apiKey?: string;

  /** Name of this service */
  serviceName?: string;

  /** Instance identifier for vector clock keys */
  instanceId?: string;

  /** Environment (dev, staging, production) */
  environment?: string;

  /** Enable/disable event capture */
  enabled?: boolean;

  /** Batch size for event buffering */
  batchSize?: number;

  /** Flush interval in milliseconds */
  flushInterval?: number;

  /** Custom tags to add to all events */
  tags?: Record<string, string>;

  /** Debug logging */
  debug?: boolean;
}

/**
 * Trace context for tracking causal relationships (deprecated - use RacewayContext)
 */
export interface TraceContext {
  traceId: UUID;
  parentId: UUID | null;
  causality_vector: Map<UUID, number>;
}

/**
 * Raceway context for automatic context propagation
 */
export interface RacewayContext {
  traceId: UUID;
  threadId: string;  // Unique ID for this request/async context
  parentId: UUID | null;
  rootId: UUID | null;
  clock: number;
  spanId: string;
  parentSpanId: string | null;
  distributed: boolean;
  clockVector: Array<[string, number]>;
  tracestate: string | null;
}

/**
 * API response from Raceway server
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
