/**
 * Core types for Causeway SDK
 */

export type UUID = string;

/**
 * Event kinds that Causeway can capture
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
}

/**
 * Configuration for Causeway SDK
 */
export interface CausewayConfig {
  /** URL of the Causeway server */
  serverUrl: string;

  /** Name of this service */
  serviceName?: string;

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
 * Trace context for tracking causal relationships
 */
export interface TraceContext {
  traceId: UUID;
  parentId: UUID | null;
  causality_vector: Map<UUID, number>;
}

/**
 * API response from Causeway server
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
