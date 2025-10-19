import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';
import {
  RacewayConfig,
  Event,
  EventData,
  EventMetadata,
  RacewayContext,
  UUID,
} from './types';
import { RacewayClient } from './client';
import { createAutoTracker, AutoTrackOptions, PropertyAccess } from './auto-track';

/**
 * AsyncLocalStorage for automatic context propagation
 */
const racewayContext = new AsyncLocalStorage<RacewayContext>();

/**
 * Main Raceway SDK class with plug-and-play architecture
 */
export class Raceway {
  private config: Required<RacewayConfig>;
  private client: RacewayClient;

  constructor(config: RacewayConfig) {
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
    this.client = new RacewayClient(
      this.config.serverUrl,
      this.config.batchSize,
      this.config.flushInterval,
      this.config.debug
    );

    if (this.config.debug) {
      console.log('[Raceway] Initialized with config:', this.config);
    }
  }

  /**
   * Express/Connect middleware for automatic trace initialization
   * Usage: app.use(raceway.middleware())
   */
  public middleware() {
    return (req: any, res: any, next: any) => {
      // Extract trace ID from header or generate new one
      // Validate UUID format (8-4-4-4-12 pattern)
      let traceId = req.headers['x-trace-id'];
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (!traceId || !uuidPattern.test(traceId)) {
        traceId = uuidv4();
      }

      // Generate unique thread ID for this request context
      const threadId = `node-${process.pid}-${uuidv4().substring(0, 8)}`;

      // Initialize context for this request
      const ctx: RacewayContext = {
        traceId,
        threadId,
        parentId: null,
        rootId: null,
        clock: 0,
      };

      // Run the rest of the request within this context
      racewayContext.run(ctx, () => {
        // Track HTTP request as root event
        this.trackHttpRequest(req.method, req.url);

        // Continue to handler
        next();
      });
    };
  }

  /**
   * Track HTTP request (simplified API - auto-reads context)
   */
  public trackHttpRequest(method: string, url: string): void {
    const ctx = racewayContext.getStore();
    if (!ctx) {
      if (this.config.debug) {
        console.warn('[Raceway] trackHttpRequest called outside of context');
      }
      return;
    }

    const location = this.captureLocation();

    const event = this.captureEvent(
      ctx.traceId,
      ctx.parentId,
      ctx.rootId,
      ctx.clock,
      {
        HttpRequest: {
          method,
          url,
          headers: {},
          body: null,
        },
      },
      location
    );

    // Update context: set root ID if first event, update parent, increment clock
    if (ctx.rootId === null) {
      ctx.rootId = event.id;
    }
    ctx.parentId = event.id;
    ctx.clock += 1;
  }

  /**
   * Track HTTP response (simplified API)
   */
  public trackHttpResponse(status: number, durationMs: number): void {
    const ctx = racewayContext.getStore();
    if (!ctx) return;

    const location = this.captureLocation();

    const event = this.captureEvent(
      ctx.traceId,
      ctx.parentId,
      ctx.rootId,
      ctx.clock,
      {
        HttpResponse: {
          status,
          headers: {},
          body: null,
          duration_ms: durationMs,
        },
      },
      location
    );

    ctx.parentId = event.id;
    ctx.clock += 1;
  }

  /**
   * Track function call (simplified API)
   */
  public trackFunctionCall(functionName: string, args: Record<string, any>): void {
    const ctx = racewayContext.getStore();
    if (!ctx) return;

    const location = this.captureLocation();
    const [file, line] = this.parseLocation(location);

    const event = this.captureEvent(
      ctx.traceId,
      ctx.parentId,
      ctx.rootId,
      ctx.clock,
      {
        FunctionCall: {
          function_name: functionName,
          module: 'unknown',
          args,
          file,
          line,
        },
      },
      location
    );

    if (ctx.rootId === null) {
      ctx.rootId = event.id;
    }
    ctx.parentId = event.id;
    ctx.clock += 1;
  }

  /**
   * Track state change (simplified API)
   */
  public trackStateChange(
    variable: string,
    oldValue: any,
    newValue: any,
    accessType: 'Read' | 'Write'
  ): void {
    const ctx = racewayContext.getStore();
    if (!ctx) return;

    const location = this.captureLocation();

    const event = this.captureEvent(
      ctx.traceId,
      ctx.parentId,
      ctx.rootId,
      ctx.clock,
      {
        StateChange: {
          variable,
          old_value: oldValue,
          new_value: newValue,
          location,
          access_type: accessType,
        },
      },
      location
    );

    if (ctx.rootId === null) {
      ctx.rootId = event.id;
    }
    ctx.parentId = event.id;
    ctx.clock += 1;
  }

  /**
   * Capture an event (internal method)
   */
  private captureEvent(
    traceId: string,
    parentId: string | null,
    rootId: string | null,
    clock: number,
    kind: EventData,
    location: string
  ): Event {
    if (!this.config.enabled) {
      return this.createDummyEvent();
    }

    // Build causality vector
    const causalityVector: Array<[UUID, number]> = rootId
      ? [[rootId, clock]]
      : [];

    // Create event
    const event: Event = {
      id: uuidv4(),
      trace_id: traceId,
      parent_id: parentId,
      timestamp: new Date().toISOString(),
      kind,
      metadata: this.buildMetadata(),
      causality_vector: causalityVector,
      lock_set: [],  // Add required lock_set field
    };

    // Buffer event
    this.client.bufferEvent(event);

    if (this.config.debug) {
      const kindName = Object.keys(kind)[0];
      console.log(`[Raceway] Captured event ${event.id}: ${kindName}`);
    }

    return event;
  }

  /**
   * Capture location from stack trace
   */
  private captureLocation(): string {
    const err = new Error();
    const stack = err.stack || '';
    const lines = stack.split('\n');

    // Find the first line that's not in the SDK
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes('raceway.ts') && !line.includes('raceway.js')) {
        // Extract file:line from stack trace
        const match = line.match(/\((.+):(\d+):(\d+)\)/) || line.match(/at (.+):(\d+):(\d+)/);
        if (match) {
          return `${match[1]}:${match[2]}`;
        }
      }
    }

    return 'unknown:0';
  }

  /**
   * Parse location string into file and line
   */
  private parseLocation(location: string): [string, number] {
    const parts = location.split(':');
    if (parts.length >= 2) {
      return [parts[0], parseInt(parts[1]) || 0];
    }
    return ['unknown', 0];
  }

  /**
   * Build event metadata
   */
  private buildMetadata(): EventMetadata {
    const ctx = racewayContext.getStore();

    return {
      thread_id: ctx?.threadId || `node-${process.pid}`,
      process_id: process.pid,
      service_name: this.config.serviceName,
      environment: this.config.environment,
      tags: { ...this.config.tags },
      duration_ns: null,
    };
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
   * Auto-track an object with JavaScript Proxies (zero-instrumentation mode)
   *
   * Wraps an object so that all property access (reads and writes) are
   * automatically tracked without manual instrumentation.
   *
   * @example
   * ```typescript
   * const accounts = raceway.track({
   *   alice: { balance: 1000 },
   *   bob: { balance: 500 }
   * }, 'accounts');
   *
   * // Now all access is automatically tracked:
   * const balance = accounts.alice.balance;  // ✅ Auto-tracked Read
   * accounts.alice.balance -= 100;            // ✅ Auto-tracked Write
   * ```
   */
  public track<T extends object>(obj: T, basePath: string, trackNested: boolean = true): T {
    const onAccess = (access: PropertyAccess) => {
      // Only track if we're inside a Raceway context
      const ctx = racewayContext.getStore();
      if (!ctx) {
        if (this.config.debug) {
          console.warn(`[Raceway] Property access to '${access.path}' outside of context`);
        }
        return;
      }

      // Automatically call trackStateChange
      this.trackStateChange(
        access.path,
        access.oldValue,
        access.newValue,
        access.accessType
      );
    };

    return createAutoTracker(obj, {
      basePath,
      trackNested,
      onAccess,
    });
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
      lock_set: [],
    };
  }

  // ============================================================
  // DEPRECATED METHODS (for backward compatibility)
  // ============================================================

  /**
   * @deprecated Use middleware() instead
   */
  public startTrace(traceId?: UUID): any {
    console.warn('[Raceway] startTrace() is deprecated. Use middleware() instead.');
    return { traceId: traceId || uuidv4(), parentId: null, causality_vector: new Map() };
  }

  /**
   * @deprecated Context is automatically managed
   */
  public endTrace(): void {
    console.warn('[Raceway] endTrace() is deprecated. Context is automatically managed.');
  }

  /**
   * @deprecated Use middleware() instead
   */
  public getCurrentTrace(): any {
    console.warn('[Raceway] getCurrentTrace() is deprecated. Context is automatically managed.');
    return racewayContext.getStore();
  }

  /**
   * @deprecated Context is automatically managed
   */
  public setCurrentTrace(trace: any): void {
    console.warn('[Raceway] setCurrentTrace() is deprecated. Context is automatically managed.');
  }
}
