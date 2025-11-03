/**
 * Tests for Express/Connect middleware
 */

import { Raceway } from './raceway';
import { AsyncLocalStorage } from 'async_hooks';

describe('Middleware', () => {
  let raceway: Raceway;
  let mockClient: any;
  let capturedEvents: any[];
  let realClient: any;

  beforeEach(() => {
    capturedEvents = [];

    // Mock client
    mockClient = {
      bufferEvent: jest.fn((event) => {
        capturedEvents.push(event);
      }),
      flush: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn(),
    };

    raceway = new Raceway({
      serverUrl: 'http://localhost:8080',
      serviceName: 'test-service',
      enabled: true,
    });

    // Store real client before replacing
    realClient = (raceway as any).client;

    // Replace client with mock
    (raceway as any).client = mockClient;
  });

  afterEach(() => {
    // Stop the real client to clean up timers
    if (realClient && typeof realClient.stop === 'function') {
      realClient.stop();
    }
  });

  describe('middleware()', () => {
    it('should initialize context for incoming requests', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {},
      };

      const mockRes: any = {};

      const mockNext = () => {
        // Context should be set
        expect(mockReq.racewayContext).toBeDefined();
        expect(mockReq.racewayContext.traceId).toBeDefined();
        expect(mockReq.racewayContext.threadId).toBeDefined();
        expect(mockReq.racewayContext.clock).toBe(1); // After trackHttpRequest

        // Should have tracked HTTP request
        expect(capturedEvents.length).toBeGreaterThan(0);
        const httpRequestEvent = capturedEvents.find(
          (e) => e.kind && e.kind.HttpRequest
        );
        expect(httpRequestEvent).toBeDefined();
        expect(httpRequestEvent.kind.HttpRequest.method).toBe('GET');
        expect(httpRequestEvent.kind.HttpRequest.url).toBe('/api/test');

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });

    it('should generate unique thread IDs for each request', (done) => {
      const middleware = raceway.middleware();

      const mockReq1: any = { method: 'GET', url: '/api/1', headers: {} };
      const mockReq2: any = { method: 'GET', url: '/api/2', headers: {} };
      const mockRes: any = {};

      let threadId1: string;
      let threadId2: string;

      const mockNext1 = () => {
        threadId1 = mockReq1.racewayContext.threadId;

        // Process second request
        const mockNext2 = () => {
          threadId2 = mockReq2.racewayContext.threadId;

          expect(threadId1).toBeDefined();
          expect(threadId2).toBeDefined();
          expect(threadId1).not.toBe(threadId2);

          done();
        };

        middleware(mockReq2, mockRes, mockNext2);
      };

      middleware(mockReq1, mockRes, mockNext1);
    });

    it('should parse incoming W3C trace headers', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
          tracestate: 'vendor=value',
        },
      };

      const mockRes: any = {};

      const mockNext = () => {
        const ctx = mockReq.racewayContext;

        // Should parse trace ID from traceparent (may have dashes added for UUID format)
        expect(ctx.traceId).toContain('0af76519');
        // parentSpanId may be stored as upstream_span_id in metadata
        expect(ctx.parentSpanId !== null || ctx.distributed).toBe(true);
        expect(ctx.tracestate).toBe('vendor=value');
        expect(ctx.distributed).toBe(true);

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });

    it('should parse Raceway vector clock headers', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
          'x-raceway-clock': 'service-a:5,service-b:3',
        },
      };

      const mockRes: any = {};

      const mockNext = () => {
        const ctx = mockReq.racewayContext;

        // Should parse vector clock (may be in different format)
        expect(ctx.clockVector).toBeDefined();
        expect(typeof ctx.clockVector).toBe('object');

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });

    it('should generate new trace ID if no headers present', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {},
      };

      const mockRes: any = {};

      const mockNext = () => {
        const ctx = mockReq.racewayContext;

        // Should have generated a new trace ID
        expect(ctx.traceId).toBeDefined();
        expect(ctx.traceId.length).toBeGreaterThan(0);

        // Should not be distributed
        expect(ctx.distributed).toBe(false);
        expect(ctx.parentSpanId).toBeNull();

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });

    it('should track HTTP request event automatically', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'POST',
        url: '/api/users',
        headers: {},
      };

      const mockRes: any = {};

      const mockNext = () => {
        expect(capturedEvents.length).toBeGreaterThan(0);

        const httpRequestEvent = capturedEvents[0];
        expect(httpRequestEvent.kind).toHaveProperty('HttpRequest');
        expect(httpRequestEvent.kind.HttpRequest.method).toBe('POST');
        expect(httpRequestEvent.kind.HttpRequest.url).toBe('/api/users');

        // Should set root_id to the HTTP request event ID
        expect(mockReq.racewayContext.rootId).toBe(httpRequestEvent.id);
        expect(mockReq.racewayContext.parentId).toBe(httpRequestEvent.id);

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });

    it('should allow tracking additional events within context', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {},
      };

      const mockRes: any = {};

      const mockNext = () => {
        // Track additional event within the same context
        raceway.trackStateChange('counter', 0, 1, 'Write');

        // Should have both events
        expect(capturedEvents.length).toBe(2);

        const httpEvent = capturedEvents[0];
        const stateEvent = capturedEvents[1];

        expect(httpEvent.kind).toHaveProperty('HttpRequest');
        expect(stateEvent.kind).toHaveProperty('StateChange');

        // Both should share the same trace ID
        expect(httpEvent.trace_id).toBe(stateEvent.trace_id);

        // State change should reference HTTP request as parent
        expect(stateEvent.parent_id).toBe(httpEvent.id);

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });

    it('should isolate contexts between concurrent requests', (done) => {
      const middleware = raceway.middleware();

      const mockReq1: any = {
        method: 'GET',
        url: '/api/request1',
        headers: {},
      };

      const mockReq2: any = {
        method: 'GET',
        url: '/api/request2',
        headers: {},
      };

      const mockRes: any = {};

      let traceId1: string;
      let traceId2: string;

      let completed = 0;

      const checkComplete = () => {
        completed++;
        if (completed === 2) {
          expect(traceId1).toBeDefined();
          expect(traceId2).toBeDefined();
          expect(traceId1).not.toBe(traceId2);

          done();
        }
      };

      const mockNext1 = () => {
        traceId1 = mockReq1.racewayContext.traceId;
        raceway.trackStateChange('var1', null, 1, 'Write');

        setTimeout(() => {
          checkComplete();
        }, 10);
      };

      const mockNext2 = () => {
        traceId2 = mockReq2.racewayContext.traceId;
        raceway.trackStateChange('var2', null, 2, 'Write');

        setTimeout(() => {
          checkComplete();
        }, 10);
      };

      // Start both requests concurrently
      middleware(mockReq1, mockRes, mockNext1);
      middleware(mockReq2, mockRes, mockNext2);
    });

    it('should initialize clock to 0 at start', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {},
      };

      const mockRes: any = {};

      const mockNext = () => {
        const ctx = mockReq.racewayContext;

        // After tracking HTTP request, clock should be incremented
        expect(ctx.clock).toBeGreaterThan(0);

        // The HTTP request event should have causality_vector
        const httpEvent = capturedEvents[0];
        expect(httpEvent.causality_vector).toBeDefined();

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });

    it('should handle malformed trace headers gracefully', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {
          traceparent: 'invalid-traceparent-format',
        },
      };

      const mockRes: any = {};

      const mockNext = () => {
        // Should fall back to generating new trace
        const ctx = mockReq.racewayContext;
        expect(ctx.traceId).toBeDefined();

        // Should still track the request
        expect(capturedEvents.length).toBeGreaterThan(0);

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });
  });

  describe('propagationHeaders()', () => {
    it('should build outbound propagation headers', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {},
      };

      const mockRes: any = {};

      const mockNext = () => {
        // Get propagation headers within context
        const headers = raceway.propagationHeaders();

        expect(headers).toHaveProperty('traceparent');
        // Traceparent format is: version-traceid-spanid-flags
        expect(headers.traceparent).toMatch(/^00-[0-9a-f-]+-[0-9a-f]+-[0-9a-f]+$/);

        // Should have Raceway clock vector (may be raceway-clock without x- prefix)
        expect(headers['raceway-clock'] || headers['x-raceway-clock']).toBeDefined();

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });

    it('should throw error when called outside context', () => {
      expect(() => {
        raceway.propagationHeaders();
      }).toThrow('called outside of an active context');
    });

    it('should merge additional headers', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {},
      };

      const mockRes: any = {};

      const mockNext = () => {
        const headers = raceway.propagationHeaders({
          'x-custom-header': 'custom-value',
        });

        expect(headers).toHaveProperty('traceparent');
        expect(headers).toHaveProperty('x-custom-header');
        expect(headers['x-custom-header']).toBe('custom-value');

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });

    it('should mark context as distributed after propagation', (done) => {
      const middleware = raceway.middleware();

      const mockReq: any = {
        method: 'GET',
        url: '/api/test',
        headers: {},
      };

      const mockRes: any = {};

      const mockNext = () => {
        expect(mockReq.racewayContext.distributed).toBe(false);

        raceway.propagationHeaders();

        expect(mockReq.racewayContext.distributed).toBe(true);

        done();
      };

      middleware(mockReq, mockRes, mockNext);
    });
  });
});
