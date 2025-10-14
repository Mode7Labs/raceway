import axios from 'axios';

interface CausewayConfig {
  endpoint: string;
  serviceName: string;
  environment: string;
  batchSize: number;
  flushInterval: number;
}

class CausewayRuntime {
  private config: CausewayConfig;
  private traceId: string;
  private spanStack: string[] = [];
  private eventBuffer: any[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(config: Partial<CausewayConfig> = {}) {
    this.config = {
      endpoint: config.endpoint ?? 'http://localhost:8080',
      serviceName: config.serviceName ?? 'unknown-service',
      environment: config.environment ?? process.env.NODE_ENV ?? 'development',
      batchSize: config.batchSize ?? 100,
      flushInterval: config.flushInterval ?? 1000,
    };

    this.traceId = this.generateId();
    this.startFlushTimer();
  }

  enterFunction(name: string, file: string, line: number, args: any[]): void {
    const spanId = this.generateId();
    this.spanStack.push(spanId);

    this.captureEvent({
      kind: 'FunctionCall',
      data: {
        function_name: name,
        module: file,
        args,
        file,
        line,
      },
      spanId,
      parentSpanId: this.spanStack[this.spanStack.length - 2],
    });
  }

  exitFunction(): void {
    this.spanStack.pop();
  }

  async trackAwait<T>(promise: Promise<T>, file: string, line: number): Promise<T> {
    const futureId = this.generateId();

    this.captureEvent({
      kind: 'AsyncAwait',
      data: {
        future_id: futureId,
        awaited_at: `${file}:${line}`,
      },
      spanId: this.currentSpan(),
    });

    try {
      const result = await promise;
      return result;
    } catch (error) {
      this.captureEvent({
        kind: 'Error',
        data: {
          error_type: (error as any).name ?? 'Error',
          message: (error as any).message ?? String(error),
          stack_trace: (error as any).stack?.split('\n') ?? [],
        },
        spanId: this.currentSpan(),
      });
      throw error;
    }
  }

  trackStateChange(varName: string, oldValue: any, newValue: any, file: string, line: number): any {
    this.captureEvent({
      kind: 'StateChange',
      data: {
        variable: varName,
        old_value: this.serializeValue(oldValue),
        new_value: this.serializeValue(newValue),
        location: `${file}:${line}`,
      },
      spanId: this.currentSpan(),
    });

    return newValue;
  }

  async trackHttp<T>(httpCall: Promise<T>, file: string, line: number): Promise<T> {
    const startTime = Date.now();

    // Capture request
    this.captureEvent({
      kind: 'HttpRequest',
      data: {
        method: 'UNKNOWN',
        url: 'UNKNOWN',
        headers: {},
        body: null,
      },
      spanId: this.currentSpan(),
    });

    try {
      const response = await httpCall;
      const duration = Date.now() - startTime;

      // Capture response
      this.captureEvent({
        kind: 'HttpResponse',
        data: {
          status: (response as any).status ?? 200,
          headers: (response as any).headers ?? {},
          body: null,
          duration_ms: duration,
        },
        spanId: this.currentSpan(),
      });

      return response;
    } catch (error) {
      this.captureEvent({
        kind: 'Error',
        data: {
          error_type: 'HttpError',
          message: (error as any).message ?? String(error),
          stack_trace: (error as any).stack?.split('\n') ?? [],
        },
        spanId: this.currentSpan(),
      });
      throw error;
    }
  }

  private captureEvent(event: any): void {
    this.eventBuffer.push({
      id: this.generateId(),
      trace_id: this.traceId,
      parent_id: event.parentSpanId ?? null,
      timestamp: new Date().toISOString(),
      kind: event.kind,
      metadata: {
        thread_id: 'main',
        process_id: process.pid,
        service_name: this.config.serviceName,
        environment: this.config.environment,
        tags: {},
        duration_ns: null,
      },
      ...event.data,
    });

    if (this.eventBuffer.length >= this.config.batchSize) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    try {
      await axios.post(`${this.config.endpoint}/events`, { events });
    } catch (error) {
      console.error('Failed to send events to Causeway:', error);
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  private currentSpan(): string {
    return this.spanStack[this.spanStack.length - 1] ?? this.traceId;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private serializeValue(value: any): any {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return '<non-serializable>';
    }
  }

  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }
}

// Global singleton
const runtime = new CausewayRuntime();

export default runtime;
