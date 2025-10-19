import { Event, ApiResponse } from './types';

/**
 * HTTP client for sending events to Raceway server
 */
export class RacewayClient {
  private serverUrl: string;
  private eventBuffer: Event[] = [];
  private batchSize: number;
  private flushInterval: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;
  private debug: boolean;

  constructor(
    serverUrl: string,
    batchSize: number = 100,
    flushInterval: number = 1000,
    debug: boolean = false
  ) {
    this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
    this.debug = debug;

    // Start periodic flush
    this.startFlushTimer();
  }

  /**
   * Add event to buffer
   */
  public bufferEvent(event: Event): void {
    this.eventBuffer.push(event);

    if (this.debug) {
      console.log(`[Raceway] Buffered event ${event.id} (buffer size: ${this.eventBuffer.length})`);
    }

    // Flush if batch size reached
    if (this.eventBuffer.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * Flush all buffered events to server
   */
  public async flush(): Promise<void> {
    if (this.isFlushing || this.eventBuffer.length === 0) {
      return;
    }

    this.isFlushing = true;
    const eventsToSend = [...this.eventBuffer];
    this.eventBuffer = [];

    try {
      if (this.debug) {
        console.log(`[Raceway] Flushing ${eventsToSend.length} events to ${this.serverUrl}/events`);
      }

      const response = await fetch(`${this.serverUrl}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events: eventsToSend }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Raceway] Failed to send events: ${response.status} ${errorText}`);
        // Re-buffer events on failure
        this.eventBuffer.unshift(...eventsToSend);
      } else {
        const result = await response.json();
        if (this.debug) {
          console.log(`[Raceway] Successfully sent events:`, result);
        }
      }
    } catch (error) {
      console.error('[Raceway] Error sending events:', error);
      // Re-buffer events on error
      this.eventBuffer.unshift(...eventsToSend);
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * Stop periodic flush timer
   */
  public stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining events
    this.flush();
  }

  /**
   * Get buffer size
   */
  public getBufferSize(): number {
    return this.eventBuffer.length;
  }
}
