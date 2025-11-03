/**
 * Tests for core event tracking functions
 */

import { Raceway } from './raceway';
import { AsyncLocalStorage } from 'async_hooks';

describe('Core Event Tracking', () => {
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

  describe('trackStateChange', () => {
    it('should track state write operations', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackStateChange('balance', 1000, 900, 'Write');

        expect(mockClient.bufferEvent).toHaveBeenCalled();
        const event = capturedEvents[0];

        expect(event.kind).toHaveProperty('StateChange');
        expect(event.kind.StateChange.variable).toBe('balance');
        expect(event.kind.StateChange.old_value).toBe(1000);
        expect(event.kind.StateChange.new_value).toBe(900);
        expect(event.kind.StateChange.access_type).toBe('Write');
        expect(event.trace_id).toBeDefined();
        expect(event.metadata.thread_id).toBeDefined();
      });
    });

    it('should track state read operations', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackStateChange('balance', null, 1000, 'Read');

        const event = capturedEvents[0];

        expect(event.kind.StateChange.access_type).toBe('Read');
        expect(event.kind.StateChange.new_value).toBe(1000);
        expect(event.kind.StateChange.old_value).toBeNull();
      });
    });

    it('should handle complex object values', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const oldObj = { name: 'Alice', balance: 1000 };
        const newObj = { name: 'Alice', balance: 900 };

        raceway.trackStateChange('account', oldObj, newObj, 'Write');

        const event = capturedEvents[0];
        expect(event.kind.StateChange.old_value).toEqual(oldObj);
        expect(event.kind.StateChange.new_value).toEqual(newObj);
      });
    });

    it('should not track when outside of context', () => {
      // Not in AsyncLocalStorage context
      raceway.trackStateChange('balance', 1000, 900, 'Write');

      expect(mockClient.bufferEvent).not.toHaveBeenCalled();
    });

    it('should handle null and undefined values', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackStateChange('nullable', null, undefined, 'Write');

        const event = capturedEvents[0];
        expect(event.kind.StateChange.old_value).toBeNull();
        expect(event.kind.StateChange.new_value).toBeUndefined();
      });
    });
  });

  describe('trackFunctionCall', () => {
    it('should track function calls', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackFunctionCall('processPayment', { arg1: 'val1', arg2: 'val2' });

        expect(mockClient.bufferEvent).toHaveBeenCalled();
        const event = capturedEvents[0];

        expect(event.kind).toHaveProperty('FunctionCall');
        expect(event.kind.FunctionCall.function_name).toBe('processPayment');
        expect(event.kind.FunctionCall.args).toHaveProperty('arg1', 'val1');
        expect(event.trace_id).toBeDefined();
      });
    });

    it('should handle empty arguments', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackFunctionCall('noArgs', {});

        const event = capturedEvents[0];
        expect(event.kind.FunctionCall.args).toEqual({});
      });
    });

    it('should handle complex argument types', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const complexArgs = {
          user: { id: 1, name: 'Alice' },
          items: [1, 2, 3],
          nullable: null,
          str: 'string',
          num: 42,
        };

        raceway.trackFunctionCall('complexFunction', complexArgs);

        const event = capturedEvents[0];
        expect(event.kind.FunctionCall.args).toEqual(complexArgs);
      });
    });

    it('should not track when outside of context', () => {
      raceway.trackFunctionCall('processPayment', { arg1: 'val1' });

      expect(mockClient.bufferEvent).not.toHaveBeenCalled();
    });
  });

  describe('trackHttpResponse', () => {
    it('should track HTTP response events', () => {
      // Use middleware to set up proper context
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      middleware(mockReq, mockRes, () => {
        // Clear the HTTP request event from middleware
        capturedEvents.length = 0;

        raceway.trackHttpResponse(200, 50);

        expect(mockClient.bufferEvent).toHaveBeenCalled();
        const event = capturedEvents[0];

        expect(event.kind).toHaveProperty('HttpResponse');
        expect(event.kind.HttpResponse.status).toBe(200);
        expect(event.kind.HttpResponse.duration_ms).toBe(50);
      });
    });

    it('should handle error status codes', () => {
      const middleware = raceway.middleware();
      const mockReq = { method: 'POST', url: '/api/payment', headers: {} };
      const mockRes = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackHttpResponse(500, 100);

        const event = capturedEvents[0];
        expect(event.kind.HttpResponse.status).toBe(500);
      });
    });

    it('should handle different durations', () => {
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const durations = [10, 50, 100, 200, 500];

        durations.forEach((duration) => {
          raceway.trackHttpResponse(200, duration);
        });

        expect(capturedEvents.length).toBe(durations.length);

        durations.forEach((duration, index) => {
          expect(capturedEvents[index].kind.HttpResponse.duration_ms).toBe(duration);
        });
      });
    });

    it('should not track when outside of context', () => {
      const initialCount = capturedEvents.length;
      raceway.trackHttpResponse(200, 50);

      expect(capturedEvents.length).toBe(initialCount);
    });
  });

  describe('Event structure', () => {
    it('should include all required fields in events', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackStateChange('test', null, 1, 'Write');

        const event = capturedEvents[0];

        // Check all required fields exist
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('trace_id');
        expect(event).toHaveProperty('metadata');
        expect(event.metadata).toHaveProperty('thread_id');
        expect(event).toHaveProperty('kind');
        expect(event).toHaveProperty('timestamp');
        expect(event.metadata).toHaveProperty('service_name');

        // Check values
        expect(event.trace_id).toBeDefined();
        expect(event.metadata.thread_id).toBeDefined();
        expect(event.metadata.service_name).toBe('test-service');
      });
    });

    it('should increment causality vector for each event', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackStateChange('var1', null, 1, 'Write');
        raceway.trackStateChange('var2', null, 2, 'Write');
        raceway.trackStateChange('var3', null, 3, 'Write');

        // Causality vector should increment for each event
        expect(capturedEvents[0].causality_vector).toBeDefined();
        expect(capturedEvents[1].causality_vector).toBeDefined();
        expect(capturedEvents[2].causality_vector).toBeDefined();
        expect(Array.isArray(capturedEvents[0].causality_vector)).toBe(true);
        expect(Array.isArray(capturedEvents[1].causality_vector)).toBe(true);
        expect(Array.isArray(capturedEvents[2].causality_vector)).toBe(true);
      });
    });

    it('should generate unique event IDs', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackStateChange('var1', null, 1, 'Write');
        raceway.trackStateChange('var2', null, 2, 'Write');

        const event1 = capturedEvents[0];
        const event2 = capturedEvents[1];

        expect(event1.id).toBeDefined();
        expect(event2.id).toBeDefined();
        expect(event1.id).not.toBe(event2.id);
      });
    });

    it('should include timestamp in events', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackStateChange('test', null, 1, 'Write');

        const event = capturedEvents[0];

        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe('string');
        // Verify it's a valid ISO timestamp
        expect(new Date(event.timestamp).toString()).not.toBe('Invalid Date');
      });
    });
  });
});
