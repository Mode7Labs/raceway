import { v4 as uuidv4 } from 'uuid';
import {
  CausewayConfig,
  Event,
  EventData,
  EventMetadata,
  TraceContext,
  UUID,
} from './types';
import { CausewayClient } from './client';

/**
 * Main Causeway SDK class
 */
export class Causeway {
  private config: Required<CausewayConfig>;
  private client: CausewayClient;
  private currentTrace: TraceContext | null = null;

  constructor(config: CausewayConfig) {
    // Set defaults
    this.config = {
      serverUrl: config.serverUrl,
      serviceName: config.serviceName || 'unknown-service',
      environment: config.environment || process.env.NODE_ENV || 'development',
      enabled: config.enabled !== undefined ? config.enabled : true,
      batchSize: config.batchSize || 100,
      flushInterval: config.flushInterval || 1000,
      tags: config.tags || {},
      debug: config.debug || false,
    };

    // Initialize HTTP client
    this.client = new CausewayClient(
      this.config.serverUrl,
      this.config.batchSize,
      this.config.flushInterval,
      this.config.debug
    );

    if (this.config.debug) {
      console.log('[Causeway] Initialized with config:', this.config);
    }
  }

  /**
   * Start a new trace
   */
  public startTrace(traceId?: UUID): TraceContext {
    const trace: TraceContext = {
      traceId: traceId || uuidv4(),
      parentId: null,
      causality_vector: new Map(),
    };

    this.currentTrace = trace;

    if (this.config.debug) {
      console.log(`[Causeway] Started trace ${trace.traceId}`);
    }

    return trace;
  }

  /**
   * Get current trace context
   */
  public getCurrentTrace(): TraceContext | null {
    return this.currentTrace;
  }

  /**
   * Set current trace context
   */
  public setCurrentTrace(trace: TraceContext | null): void {
    this.currentTrace = trace;
  }

  /**
   * End current trace
   */
  public endTrace(): void {
    if (this.currentTrace && this.config.debug) {
      console.log(`[Causeway] Ended trace ${this.currentTrace.traceId}`);
    }
    this.currentTrace = null;
  }

  /**
   * Capture an event
   */
  public captureEvent(
    kind: EventData,
    options?: {
      trace?: TraceContext;
      parentId?: UUID;
      timestamp?: Date;
      tags?: Record<string, string>;
      duration_ns?: number;
    }
  ): Event {
    if (!this.config.enabled) {
      // Return dummy event if disabled
      return this.createDummyEvent();
    }

    // Use provided trace or current trace
    const trace = options?.trace || this.currentTrace;

    if (!trace) {
      throw new Error(
        '[Causeway] No trace context available. Call startTrace() first or provide trace in options.'
      );
    }

    // Create event
    const event: Event = {
      id: uuidv4(),
      trace_id: trace.traceId,
      parent_id: options?.parentId || trace.parentId,
      timestamp: (options?.timestamp || new Date()).toISOString(),
      kind,
      metadata: this.buildMetadata(options?.tags, options?.duration_ns),
      causality_vector: this.buildCausalityVector(trace),
    };

    // Update causality vector
    trace.causality_vector.set(event.id, 1);

    // Update parent for next event
    trace.parentId = event.id;

    // Buffer event
    this.client.bufferEvent(event);

    if (this.config.debug) {
      console.log(`[Causeway] Captured event ${event.id}:`, kind);
    }

    return event;
  }

  /**
   * Capture a function call event
   */
  public captureFunctionCall(
    functionName: string,
    args: Record<string, any>,
    options?: {
      module?: string;
      file?: string;
      line?: number;
      trace?: TraceContext;
    }
  ): Event {
    return this.captureEvent(
      {
        FunctionCall: {
          function_name: functionName,
          module: options?.module || 'unknown',
          args,
          file: options?.file || 'unknown',
          line: options?.line || 0,
        },
      },
      options
    );
  }

  /**
   * Capture a state change event
   */
  public captureStateChange(
    variable: string,
    newValue: any,
    oldValue: any | null,
    location: string,
    options?: {
      trace?: TraceContext;
    }
  ): Event {
    return this.captureEvent(
      {
        StateChange: {
          variable,
          old_value: oldValue,
          new_value: newValue,
          location,
        },
      },
      options
    );
  }

  /**
   * Capture an HTTP request event
   */
  public captureHttpRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: any,
    options?: {
      trace?: TraceContext;
    }
  ): Event {
    return this.captureEvent(
      {
        HttpRequest: {
          method,
          url,
          headers,
          body,
        },
      },
      options
    );
  }

  /**
   * Capture an HTTP response event
   */
  public captureHttpResponse(
    status: number,
    headers: Record<string, string>,
    durationMs: number,
    body?: any,
    options?: {
      trace?: TraceContext;
    }
  ): Event {
    return this.captureEvent(
      {
        HttpResponse: {
          status,
          headers,
          body,
          duration_ms: durationMs,
        },
      },
      { ...options, duration_ns: durationMs * 1_000_000 }
    );
  }

  /**
   * Capture a custom event
   */
  public captureCustom(
    name: string,
    data: Record<string, any>,
    options?: {
      trace?: TraceContext;
    }
  ): Event {
    return this.captureEvent(
      {
        Custom: {
          name,
          data,
        },
      },
      options
    );
  }

  /**
   * Flush all buffered events immediately
   */
  public async flush(): Promise<void> {
    return this.client.flush();
  }

  /**
   * Stop the SDK and flush remaining events
   */
  public async stop(): Promise<void> {
    this.client.stop();
    await this.flush();
  }

  /**
   * Build event metadata
   */
  private buildMetadata(
    customTags?: Record<string, string>,
    duration_ns?: number
  ): EventMetadata {
    return {
      thread_id: this.getThreadId(),
      process_id: process.pid,
      service_name: this.config.serviceName,
      environment: this.config.environment,
      tags: { ...this.config.tags, ...customTags },
      duration_ns: duration_ns || null,
    };
  }

  /**
   * Build causality vector from trace context
   */
  private buildCausalityVector(trace: TraceContext): Array<[UUID, number]> {
    return Array.from(trace.causality_vector.entries());
  }

  /**
   * Get current thread/async context ID
   */
  private getThreadId(): string {
    // In Node.js, we can use AsyncLocalStorage or just return a constant
    // For now, use a simple identifier
    return `node-${process.pid}`;
  }

  /**
   * Create dummy event when SDK is disabled
   */
  private createDummyEvent(): Event {
    return {
      id: uuidv4(),
      trace_id: uuidv4(),
      parent_id: null,
      timestamp: new Date().toISOString(),
      kind: { Custom: { name: 'dummy', data: {} } },
      metadata: {
        thread_id: '',
        process_id: 0,
        service_name: '',
        environment: '',
        tags: {},
        duration_ns: null,
      },
      causality_vector: [],
    };
  }
}
