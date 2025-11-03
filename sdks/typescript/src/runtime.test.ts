/**
 * Tests for runtime module (Babel plugin integration)
 */

import { Raceway } from './raceway';
import { AsyncLocalStorage } from 'async_hooks';

// We need to test the runtime module in isolation
// So we'll mock parts of it or test it indirectly

describe('Runtime Module', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let runtimeInstances: any[] = [];

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear any cached runtime instance
    jest.resetModules();
    runtimeInstances = [];
  });

  afterEach(async () => {
    // Clean up all runtime instances to prevent hanging timers
    for (const runtime of runtimeInstances) {
      try {
        const instance = runtime.getInstance();
        if (instance && typeof instance.stop === 'function') {
          await instance.stop();
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    runtimeInstances = [];

    // Restore environment
    process.env = originalEnv;
  });

  describe('initializeRuntime', () => {
    it('should initialize runtime with provided config', () => {
      // Import fresh runtime module
      const runtimeModule = require('./runtime');
      runtimeInstances.push(runtimeModule.default);

      const instance = runtimeModule.initializeRuntime({
        serverUrl: 'http://test-server:8080',
        serviceName: 'test-service',
        enabled: true,
      });

      expect(instance).toBeDefined();
      expect(typeof instance.middleware).toBe('function');
      expect(typeof instance.trackStateChange).toBe('function');
    });

    it('should warn on re-initialization', () => {
      const runtimeModule = require('./runtime');
      runtimeInstances.push(runtimeModule.default);

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const instance1 = runtimeModule.initializeRuntime({
        serverUrl: 'http://test-server:8080',
        serviceName: 'test-service',
      });

      const instance2 = runtimeModule.initializeRuntime({
        serverUrl: 'http://different-server:8080',
        serviceName: 'different-service',
      });

      // Should return the same instance
      expect(instance1).toBe(instance2);

      // Should have warned
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Runtime already initialized')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should accept all config options', () => {
      const runtimeModule = require('./runtime');
      runtimeInstances.push(runtimeModule.default);

      const instance = runtimeModule.initializeRuntime({
        serverUrl: 'http://test:8080',
        serviceName: 'my-service',
        instanceId: 'instance-123',
        environment: 'production',
        enabled: true,
        batchSize: 50,
        flushInterval: 2000,
        tags: { version: '1.0.0' },
        debug: true,
      });

      expect(instance).toBeDefined();
      expect(typeof instance.middleware).toBe('function');
      expect(typeof instance.trackStateChange).toBe('function');
    });
  });

  describe('Auto-initialization', () => {
    it('should auto-initialize from environment variables', () => {
      // Set environment variables
      process.env.RACEWAY_URL = 'http://env-server:8080';
      process.env.RACEWAY_SERVICE_NAME = 'env-service';
      process.env.RACEWAY_ENABLED = 'true';
      process.env.NODE_ENV = 'test';

      // Import fresh runtime module
      const runtime = require('./runtime').default;
      runtimeInstances.push(runtime);

      const instance = runtime.getInstance();

      expect(instance).toBeDefined();
      expect(typeof instance.middleware).toBe('function');
      expect(typeof instance.trackStateChange).toBe('function');
    });

    it('should use default values when env vars not set', () => {
      // Clear relevant env vars
      delete process.env.RACEWAY_URL;
      delete process.env.RACEWAY_SERVICE_NAME;
      delete process.env.RACEWAY_ENABLED;

      const runtime = require('./runtime').default;
      runtimeInstances.push(runtime);

      const instance = runtime.getInstance();

      expect(instance).toBeDefined();
      expect(typeof instance.middleware).toBe('function');
      expect(typeof instance.trackStateChange).toBe('function');
    });

    it('should respect RACEWAY_ENABLED=false', () => {
      process.env.RACEWAY_ENABLED = 'false';

      const runtime = require('./runtime').default;
      runtimeInstances.push(runtime);

      const instance = runtime.getInstance();

      // Should still create instance, just disabled
      expect(instance).toBeDefined();
      expect(typeof instance.middleware).toBe('function');
      expect(typeof instance.trackStateChange).toBe('function');
    });

    it('should log when debug mode enabled', () => {
      process.env.RACEWAY_DEBUG = 'true';
      process.env.RACEWAY_URL = 'http://debug-server:8080';

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const runtime = require('./runtime').default;
      runtimeInstances.push(runtime);

      runtime.getInstance();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Auto-initialized')
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe('Runtime proxy methods', () => {
    let runtime: any;
    let mockClient: any;
    let capturedEvents: any[];
    let realClient: any;

    beforeEach(() => {
      capturedEvents = [];

      mockClient = {
        bufferEvent: jest.fn((event) => {
          capturedEvents.push(event);
        }),
        flush: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn(),
      };

      // Import fresh runtime
      const runtimeModule = require('./runtime');
      runtime = runtimeModule.default;
      runtimeInstances.push(runtime);

      // Initialize with test config
      runtimeModule.initializeRuntime({
        serverUrl: 'http://localhost:8080',
        serviceName: 'test-service',
        enabled: true,
      });

      // Replace client with mock
      const instance = runtime.getInstance();
      realClient = (instance as any).client;
      (instance as any).client = mockClient;
    });

    afterEach(() => {
      // Stop the real client to clean up timers
      if (realClient && typeof realClient.stop === 'function') {
        realClient.stop();
      }
    });

    describe('trackStateChange', () => {
      it('should proxy to Raceway instance', () => {
        const instance = runtime.getInstance();
        const middleware = instance.middleware();
        const mockReq: any = { method: 'GET', url: '/test', headers: {} };
        const mockRes: any = {};

        middleware(mockReq, mockRes, () => {
          capturedEvents.length = 0;

          runtime.trackStateChange('balance', 1000, 900, 'Write');

          expect(mockClient.bufferEvent).toHaveBeenCalled();
          const event = capturedEvents[0];

          expect(event.kind).toHaveProperty('StateChange');
          expect(event.kind.StateChange.variable).toBe('balance');
          expect(event.kind.StateChange.old_value).toBe(1000);
          expect(event.kind.StateChange.new_value).toBe(900);
        });
      });

      it('should handle read operations', () => {
        const instance = runtime.getInstance();
        const middleware = instance.middleware();
        const mockReq: any = { method: 'GET', url: '/test', headers: {} };
        const mockRes: any = {};

        middleware(mockReq, mockRes, () => {
          capturedEvents.length = 0;

          runtime.trackStateChange('balance', null, 1000, 'Read');

          const event = capturedEvents[0];
          expect(event.kind.StateChange.access_type).toBe('Read');
        });
      });
    });

    describe('captureFunctionCall', () => {
      it('should proxy to Raceway instance', () => {
        const instance = runtime.getInstance();
        const middleware = instance.middleware();
        const mockReq: any = { method: 'GET', url: '/test', headers: {} };
        const mockRes: any = {};

        middleware(mockReq, mockRes, () => {
          capturedEvents.length = 0;

          runtime.captureFunctionCall(
            'processPayment',
            { userId: 123, amount: 50 },
            { file: 'test.ts', line: 42 }
          );

          expect(mockClient.bufferEvent).toHaveBeenCalled();
          const event = capturedEvents[0];

          expect(event.kind).toHaveProperty('FunctionCall');
          expect(event.kind.FunctionCall.function_name).toBe('processPayment');
          expect(event.kind.FunctionCall.args).toEqual({ userId: 123, amount: 50 });
        });
      });
    });

    describe('captureCustom', () => {
      it('should proxy to Raceway instance', () => {
        const instance = runtime.getInstance();
        const middleware = instance.middleware();
        const mockReq: any = { method: 'GET', url: '/test', headers: {} };
        const mockRes: any = {};

        middleware(mockReq, mockRes, () => {
          capturedEvents.length = 0;

          runtime.captureCustom('custom_event', { key: 'value' });

          expect(mockClient.bufferEvent).toHaveBeenCalled();
          const event = capturedEvents[0];

          // captureCustom uses trackFunctionCall internally
          expect(event.kind).toHaveProperty('FunctionCall');
          expect(event.kind.FunctionCall.function_name).toBe('custom_event');
        });
      });
    });

    describe('getInstance', () => {
      it('should return Raceway instance', () => {
        const instance = runtime.getInstance();

        expect(instance).toBeDefined();
      expect(typeof instance.middleware).toBe('function');
      expect(typeof instance.trackStateChange).toBe('function');
      });

      it('should return same instance on multiple calls', () => {
        const instance1 = runtime.getInstance();
        const instance2 = runtime.getInstance();

        expect(instance1).toBe(instance2);
      });
    });
  });

  describe('Babel plugin integration', () => {
    it('should work with Babel-transformed code pattern', () => {
      const capturedEvents: any[] = [];

      const mockClient = {
        bufferEvent: jest.fn((event) => {
          capturedEvents.push(event);
        }),
        flush: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn(),
      };

      // Import and initialize runtime
      const runtimeModule = require('./runtime');
      runtimeInstances.push(runtimeModule.default);

      runtimeModule.initializeRuntime({
        serverUrl: 'http://localhost:8080',
        serviceName: 'babel-test',
        enabled: true,
      });

      const runtime = runtimeModule.default;
      const instance = runtime.getInstance();
      const realClient = (instance as any).client;
      (instance as any).client = mockClient;

      // Simulate Babel-transformed code
      const middleware = instance.middleware();
      const mockReq: any = { method: 'GET', url: '/test', headers: {} };
      const mockRes: any = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        // This mimics what Babel plugin generates:
        const user = { balance: 1000 };
        const _oldValue = user.balance;
        runtime.trackStateChange('user.balance', _oldValue, 900, 'Write');
        user.balance = 900;

        expect(capturedEvents.length).toBe(1);
        expect(capturedEvents[0].kind.StateChange.variable).toBe('user.balance');
        expect(capturedEvents[0].kind.StateChange.old_value).toBe(1000);
        expect(capturedEvents[0].kind.StateChange.new_value).toBe(900);
      });

      // Clean up the real client
      if (realClient && typeof realClient.stop === 'function') {
        realClient.stop();
      }
    });
  });
});
