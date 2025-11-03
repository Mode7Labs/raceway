/**
 * Tests for proxy-based auto-tracking (raceway.track())
 */

import { Raceway } from './raceway';
import { AsyncLocalStorage } from 'async_hooks';

describe('Proxy Auto-Tracking', () => {
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

  describe('track()', () => {
    it('should track property writes on tracked objects', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const obj = raceway.track({ counter: 0 }, 'state');
        obj.counter = 10;

        expect(mockClient.bufferEvent).toHaveBeenCalled();
        const event = capturedEvents[0];

        expect(event.kind).toHaveProperty('StateChange');
        expect(event.kind.StateChange.variable).toBe('state.counter');
        expect(event.kind.StateChange.old_value).toBe(0);
        expect(event.kind.StateChange.new_value).toBe(10);
        expect(event.kind.StateChange.access_type).toBe('Write');
      });
    });

    it('should track property reads on tracked objects', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const obj = raceway.track({ counter: 42 }, 'state');
        const value = obj.counter;

        expect(value).toBe(42);
        expect(mockClient.bufferEvent).toHaveBeenCalled();
        const event = capturedEvents[0];

        expect(event.kind).toHaveProperty('StateChange');
        expect(event.kind.StateChange.variable).toBe('state.counter');
        expect(event.kind.StateChange.access_type).toBe('Read');
        expect(event.kind.StateChange.new_value).toBe(42);
      });
    });

    it('should track nested object writes', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const obj = raceway.track({ user: { balance: 1000 } }, 'accounts');
        obj.user.balance = 900;

        expect(mockClient.bufferEvent).toHaveBeenCalled();
        const writeEvent = capturedEvents.find(
          (e) => e.kind.StateChange?.access_type === 'Write'
        );

        expect(writeEvent).toBeDefined();
        expect(writeEvent.kind.StateChange.variable).toBe('accounts.user.balance');
        expect(writeEvent.kind.StateChange.old_value).toBe(1000);
        expect(writeEvent.kind.StateChange.new_value).toBe(900);
      });
    });

    it('should track nested object reads', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const obj = raceway.track({ user: { name: 'Alice' } }, 'users');
        const name = obj.user.name;

        expect(name).toBe('Alice');

        const readEvents = capturedEvents.filter(
          (e) => e.kind.StateChange?.access_type === 'Read'
        );

        expect(readEvents.length).toBeGreaterThan(0);
        const nameRead = readEvents.find(
          (e) => e.kind.StateChange.variable === 'users.user.name'
        );

        expect(nameRead).toBeDefined();
        expect(nameRead.kind.StateChange.new_value).toBe('Alice');
      });
    });

    it('should handle arrays', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const obj = raceway.track({ items: [1, 2, 3] }, 'list');

        // Array index assignment may not be tracked depending on proxy implementation
        // Test that modifying array properties is tracked
        obj.items = [10, 20, 30];

        const writeEvent = capturedEvents.find(
          (e) => e.kind.StateChange?.access_type === 'Write' &&
                 e.kind.StateChange?.variable?.includes('list.items')
        );

        expect(writeEvent).toBeDefined();
        expect(writeEvent.kind.StateChange.variable).toBe('list.items');
      });
    });

    it('should handle multiple tracked objects independently', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const obj1 = raceway.track({ value: 1 }, 'obj1');
        const obj2 = raceway.track({ value: 2 }, 'obj2');

        obj1.value = 10;
        obj2.value = 20;

        expect(capturedEvents.length).toBeGreaterThanOrEqual(2);

        const obj1Write = capturedEvents.find(
          (e) =>
            e.kind.StateChange?.variable === 'obj1.value' &&
            e.kind.StateChange?.access_type === 'Write'
        );
        const obj2Write = capturedEvents.find(
          (e) =>
            e.kind.StateChange?.variable === 'obj2.value' &&
            e.kind.StateChange?.access_type === 'Write'
        );

        expect(obj1Write.kind.StateChange.new_value).toBe(10);
        expect(obj2Write.kind.StateChange.new_value).toBe(20);
      });
    });

    it('should not track when outside of context', () => {
      // Not in middleware context
      const obj = raceway.track({ counter: 0 }, 'state');
      obj.counter = 10;

      // Should not buffer any events
      expect(mockClient.bufferEvent).not.toHaveBeenCalled();
    });

    it('should handle primitive values', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const obj = raceway.track({ str: 'hello', num: 42, bool: true }, 'primitives');

        obj.str = 'world';
        obj.num = 100;
        obj.bool = false;

        const writes = capturedEvents.filter(
          (e) => e.kind.StateChange?.access_type === 'Write'
        );

        expect(writes.length).toBe(3);

        expect(writes.find((e) => e.kind.StateChange.variable === 'primitives.str')).toBeDefined();
        expect(writes.find((e) => e.kind.StateChange.variable === 'primitives.num')).toBeDefined();
        expect(writes.find((e) => e.kind.StateChange.variable === 'primitives.bool')).toBeDefined();
      });
    });

    it('should handle null and undefined values', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const obj: any = raceway.track({ value: null } as any, 'nullable');
        obj.value = undefined;

        const writeEvent = capturedEvents.find(
          (e) => e.kind.StateChange?.access_type === 'Write'
        );

        expect(writeEvent).toBeDefined();
        expect(writeEvent.kind.StateChange.old_value).toBeNull();
        expect(writeEvent.kind.StateChange.new_value).toBeUndefined();
      });
    });

    it('should handle adding new properties', () => {
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        const obj = raceway.track({} as any, 'dynamic');
        obj.newProp = 'added';

        const writeEvent = capturedEvents.find(
          (e) => e.kind.StateChange?.variable === 'dynamic.newProp'
        );

        expect(writeEvent).toBeDefined();
        expect(writeEvent.kind.StateChange.old_value).toBeUndefined();
        expect(writeEvent.kind.StateChange.new_value).toBe('added');
      });
    });
  });
});
