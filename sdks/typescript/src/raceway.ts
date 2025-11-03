import { AsyncLocalStorage } from 'async_hooks';
import os from 'os';
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
import {
  parseIncomingTraceHeaders,
  buildPropagationHeaders,
  incrementClockVector,
} from './trace-context';

/**
 * AsyncLocalStorage for automatic context propagation
 */
const racewayContext = new AsyncLocalStorage<RacewayContext>();

const safeHostname = (): string => {
  try {
    return os.hostname();
  } catch {
    return 'instance';
  }
};

/**
 * Generate high-resolution timestamp with microsecond precision
 * Format: 2025-10-27T04:28:42.836234Z
 */
const getHighResolutionTimestamp = (): string => {
  const now = Date.now(); // milliseconds since epoch
  const hrtime = process.hrtime(); // [seconds, nanoseconds] since arbitrary time

  // Get microseconds from nanoseconds (3 additional digits of precision)
  const microseconds = Math.floor(hrtime[1] / 1000);

  // Create date with millisecond precision
  const date = new Date(now);

  // Get ISO string and inject microseconds
  // ISO format: 2025-10-27T04:28:42.836Z
  // We want:    2025-10-27T04:28:42.836234Z
  const isoString = date.toISOString();
  const dotIndex = isoString.indexOf('.');
  const beforeDot = isoString.substring(0, dotIndex + 1);
  const millisStr = isoString.substring(dotIndex + 1, dotIndex + 4);
  const microsStr = String(microseconds).padStart(6, '0').substring(3, 6);

  return `${beforeDot}${millisStr}${microsStr}Z`;
};

/**
 * Main Raceway SDK class with plug-and-play architecture
 */
export class Raceway {
  private config: RacewayConfig & {
    serviceName: string;
    instanceId: string;
    environment: string;
    enabled: boolean;
    batchSize: number;
    flushInterval: number;
    tags: Record<string, string>;
    debug: boolean;
  };
  private client: RacewayClient;

  constructor(config: RacewayConfig) {
    // Set defaults
    this.config = {
      serverUrl: config.serverUrl,
      apiKey: config.apiKey,
      serviceName: config.serviceName || 'unknown-service',
      instanceId:
        config.instanceId ||
        process.env.RACEWAY_INSTANCE_ID ||
        `${safeHostname()}-${process.pid}`,
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
      this.config.debug,
      this.config.apiKey
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
      // Generate unique thread ID for this request context
      const threadId = `node-${process.pid}-${uuidv4().substring(0, 8)}`;

      const parsed = parseIncomingTraceHeaders(req.headers, {
        serviceName: this.config.serviceName,
        instanceId: this.config.instanceId,
      });

      // Initialize context for this request
      const ctx: RacewayContext = {
        traceId: parsed.traceId,
        threadId,
        parentId: null,
        rootId: null,
        clock: 0,
        spanId: parsed.spanId,
        parentSpanId: parsed.parentSpanId,
        distributed: parsed.distributed,
        clockVector: parsed.clockVector,
        tracestate: parsed.tracestate,
      };

      // Expose context on request object for advanced use-cases
      req.racewayContext = ctx;

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
   * Build outbound propagation headers for HTTP/gRPC requests.
   */
  public propagationHeaders(additional: Record<string, string> = {}): Record<string, string> {
    const ctx = racewayContext.getStore();
    if (!ctx) {
      throw new Error('Raceway propagationHeaders() called outside of an active context');
    }

    const { headers, clockVector } = buildPropagationHeaders(ctx, {
      serviceName: this.config.serviceName,
      instanceId: this.config.instanceId,
    });

    ctx.clockVector = clockVector;
    ctx.distributed = true;

    return {
      ...headers,
      ...additional,
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

    // Convert duration from ms to ns for metadata
    const durationNs = Math.floor(durationMs * 1_000_000);

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
      location,
      durationNs
    );

    ctx.parentId = event.id;
    ctx.clock += 1;
  }

  /**
   * Track function call (simplified API)
   */
  public trackFunctionCall(functionName: string, args: Record<string, any>, durationNs?: number): void {
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
      location,
      durationNs
    );

    if (ctx.rootId === null) {
      ctx.rootId = event.id;
    }
    ctx.parentId = event.id;
    ctx.clock += 1;
  }

  /**
   * Wrap a function to automatically track its execution with duration
   *
   * @example
   * ```typescript
   * const result = await raceway.trackFunction('processPayment', { userId: 123 }, async () => {
   *   // Your function logic here
   *   return await processPayment(userId);
   * });
   * ```
   */
  public async trackFunction<T>(
    functionName: string,
    args: Record<string, any>,
    fn: () => T | Promise<T>
  ): Promise<T> {
    const startTime = process.hrtime.bigint();

    try {
      const result = await Promise.resolve(fn());
      const endTime = process.hrtime.bigint();
      const durationNs = Number(endTime - startTime);

      this.trackFunctionCall(functionName, args, durationNs);

      return result;
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const durationNs = Number(endTime - startTime);

      this.trackFunctionCall(functionName, args, durationNs);
      throw error;
    }
  }

  /**
   * Synchronous version of trackFunction for non-async functions
   */
  public trackFunctionSync<T>(
    functionName: string,
    args: Record<string, any>,
    fn: () => T
  ): T {
    const startTime = process.hrtime.bigint();

    try {
      const result = fn();
      const endTime = process.hrtime.bigint();
      const durationNs = Number(endTime - startTime);

      this.trackFunctionCall(functionName, args, durationNs);

      return result;
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const durationNs = Number(endTime - startTime);

      this.trackFunctionCall(functionName, args, durationNs);
      throw error;
    }
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
   * Track lock acquisition
   */
  public trackLockAcquire(lockId: string, lockType: string = 'Mutex'): void {
    const ctx = racewayContext.getStore();
    if (!ctx) return;

    const location = this.captureLocation();

    const event = this.captureEvent(
      ctx.traceId,
      ctx.parentId,
      ctx.rootId,
      ctx.clock,
      {
        LockAcquire: {
          lock_id: lockId,
          lock_type: lockType,
          location: location,
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
   * Track lock release
   */
  public trackLockRelease(lockId: string, lockType: string = 'Mutex'): void {
    const ctx = racewayContext.getStore();
    if (!ctx) return;

    const location = this.captureLocation();

    const event = this.captureEvent(
      ctx.traceId,
      ctx.parentId,
      ctx.rootId,
      ctx.clock,
      {
        LockRelease: {
          lock_id: lockId,
          lock_type: lockType,
          location: location,
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
   * Execute a function with automatic lock tracking
   *
   * This is a convenience wrapper that automatically tracks lock acquisition
   * and release, even in the presence of errors.
   *
   * @example
   * ```typescript
   * await raceway.withLock(myLock, 'account_lock', async () => {
   *   // Lock is automatically tracked as acquired
   *   await updateAccount();
   *   // Lock is automatically tracked as released
   * });
   * ```
   */
  public async withLock<T>(
    lock: { lock(): Promise<void>; unlock(): void } | { acquire(): void; release(): void },
    lockId: string,
    lockType: string = 'Mutex',
    fn: () => Promise<T>
  ): Promise<T> {
    // Acquire the lock
    if ('lock' in lock) {
      await lock.lock();
    } else {
      lock.acquire();
    }

    this.trackLockAcquire(lockId, lockType);

    try {
      const result = await fn();
      return result;
    } finally {
      this.trackLockRelease(lockId, lockType);
      if ('unlock' in lock) {
        lock.unlock();
      } else {
        lock.release();
      }
    }
  }

  /**
   * Synchronous version of withLock for non-async locks
   *
   * @example
   * ```typescript
   * raceway.withLockSync(myLock, 'account_lock', () => {
   *   // Lock is automatically tracked
   *   updateAccountSync();
   * });
   * ```
   */
  public withLockSync<T>(
    lock: { acquire(): void; release(): void },
    lockId: string,
    lockType: string = 'Mutex',
    fn: () => T
  ): T {
    lock.acquire();
    this.trackLockAcquire(lockId, lockType);

    try {
      const result = fn();
      return result;
    } finally {
      this.trackLockRelease(lockId, lockType);
      lock.release();
    }
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
    location: string,
    durationNs?: number
  ): Event {
    if (!this.config.enabled) {
      return this.createDummyEvent();
    }

    const ctx = racewayContext.getStore();
    if (ctx) {
      ctx.clockVector = incrementClockVector(ctx.clockVector, {
        serviceName: this.config.serviceName,
        instanceId: this.config.instanceId,
      });
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
      timestamp: getHighResolutionTimestamp(),
      kind,
      metadata: this.buildMetadata(durationNs),
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
  private buildMetadata(durationNs?: number): EventMetadata {
    const ctx = racewayContext.getStore();

    const metadata = {
      thread_id: ctx?.threadId || `node-${process.pid}`,
      process_id: process.pid,
      service_name: this.config.serviceName,
      environment: this.config.environment,
      tags: { sdk_language: 'typescript', ...this.config.tags },
      duration_ns: durationNs !== undefined ? durationNs : null,
      // Phase 2: Distributed tracing fields
      // Always set distributed metadata when we have a context (not gated by distributed flag)
      // This ensures entry-point services also create distributed spans
      instance_id: ctx ? this.config.instanceId : null,
      distributed_span_id: ctx?.spanId || null,
      upstream_span_id: ctx?.parentSpanId || null,
    };

    // Debug logging for distributed tracing
    if (this.config.debug && ctx) {
      console.log('[Raceway] Distributed metadata:', {
        distributed: ctx.distributed,
        instance_id: metadata.instance_id,
        distributed_span_id: metadata.distributed_span_id,
        upstream_span_id: metadata.upstream_span_id,
      });
    }

    return metadata;
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
      timestamp: getHighResolutionTimestamp(),
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
