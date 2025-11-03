/**
 * Tests for lock helper functions
 */

import { Raceway } from './raceway';

// Mock lock implementations
class MockAsyncLock {
  private locked = false;

  async lock(): Promise<void> {
    if (this.locked) {
      throw new Error('Lock already acquired');
    }
    this.locked = true;
  }

  unlock(): void {
    this.locked = false;
  }

  isLocked(): boolean {
    return this.locked;
  }
}

class MockSyncLock {
  private locked = false;

  acquire(): void {
    if (this.locked) {
      throw new Error('Lock already acquired');
    }
    this.locked = true;
  }

  release(): void {
    this.locked = false;
  }

  isLocked(): boolean {
    return this.locked;
  }
}

describe('Lock Helpers', () => {
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

  describe('trackLockAcquire', () => {
    it('should track lock acquisition', () => {
      // Use middleware to establish proper context
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      middleware(mockReq, mockRes, () => {
        // Clear the HTTP request event from middleware
        capturedEvents.length = 0;

        raceway.trackLockAcquire('test-lock', 'Mutex');

        expect(mockClient.bufferEvent).toHaveBeenCalled();
        const event = capturedEvents[0];

        expect(event.kind).toHaveProperty('LockAcquire');
        expect(event.kind.LockAcquire.lock_id).toBe('test-lock');
        expect(event.kind.LockAcquire.lock_type).toBe('Mutex');
      });
    });

    it('should default lock type to Mutex', () => {
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackLockAcquire('test-lock');

        const event = capturedEvents[0];
        expect(event.kind.LockAcquire.lock_type).toBe('Mutex');
      });
    });
  });

  describe('trackLockRelease', () => {
    it('should track lock release', () => {
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.trackLockRelease('test-lock', 'RWLock');

        expect(mockClient.bufferEvent).toHaveBeenCalled();
        const event = capturedEvents[0];

        expect(event.kind).toHaveProperty('LockRelease');
        expect(event.kind.LockRelease.lock_id).toBe('test-lock');
        expect(event.kind.LockRelease.lock_type).toBe('RWLock');
      });
    });
  });

  describe('withLock (async)', () => {
    it('should acquire and release lock automatically', async () => {
      const lock = new MockAsyncLock();
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      expect(lock.isLocked()).toBe(false);

      await new Promise<void>((resolve) => {
        middleware(mockReq, mockRes, async () => {
          let lockWasAcquired = false;

          await raceway.withLock(lock, 'test-lock', 'Mutex', async () => {
            lockWasAcquired = lock.isLocked();
          });

          expect(lockWasAcquired).toBe(true);
          expect(lock.isLocked()).toBe(false); // Released after
          resolve();
        });
      });
    });

    it('should track both acquire and release events', async () => {
      const lock = new MockAsyncLock();
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      await new Promise<void>((resolve) => {
        middleware(mockReq, mockRes, async () => {
          capturedEvents.length = 0;

          await raceway.withLock(lock, 'test-lock', 'Mutex', async () => {
            // Do some work
          });

          expect(mockClient.bufferEvent).toHaveBeenCalled();
          expect(capturedEvents.length).toBe(2);

          // First event should be acquire
          expect(capturedEvents[0].kind).toHaveProperty('LockAcquire');
          expect(capturedEvents[0].kind.LockAcquire.lock_id).toBe('test-lock');

          // Second event should be release
          expect(capturedEvents[1].kind).toHaveProperty('LockRelease');
          expect(capturedEvents[1].kind.LockRelease.lock_id).toBe('test-lock');

          resolve();
        });
      });
    });

    it('should release lock even if function throws', async () => {
      const lock = new MockAsyncLock();
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      await new Promise<void>((resolve) => {
        middleware(mockReq, mockRes, async () => {
          capturedEvents.length = 0;

          await expect(
            raceway.withLock(lock, 'test-lock', 'Mutex', async () => {
              throw new Error('Test error');
            })
          ).rejects.toThrow('Test error');

          // Lock should still be released
          expect(lock.isLocked()).toBe(false);

          // Should still track both events
          expect(capturedEvents.length).toBe(2);
          expect(capturedEvents[0].kind).toHaveProperty('LockAcquire');
          expect(capturedEvents[1].kind).toHaveProperty('LockRelease');

          resolve();
        });
      });
    });

    it('should return function result', async () => {
      const lock = new MockAsyncLock();
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      const result = await new Promise<number>((resolve) => {
        middleware(mockReq, mockRes, async () => {
          const value = await raceway.withLock(lock, 'test-lock', 'Mutex', async () => {
            return 42;
          });
          resolve(value);
        });
      });

      expect(result).toBe(42);
    });

    it('should work with locks that have acquire/release methods', async () => {
      const lock = new MockSyncLock();
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      await new Promise<void>((resolve) => {
        middleware(mockReq, mockRes, async () => {
          await raceway.withLock(lock, 'test-lock', 'Mutex', async () => {
            expect(lock.isLocked()).toBe(true);
          });

          expect(lock.isLocked()).toBe(false);
          resolve();
        });
      });
    });
  });

  describe('withLockSync', () => {
    it('should acquire and release lock synchronously', () => {
      const lock = new MockSyncLock();
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      expect(lock.isLocked()).toBe(false);

      middleware(mockReq, mockRes, () => {
        let lockWasAcquired = false;

        raceway.withLockSync(lock, 'test-lock', 'Mutex', () => {
          lockWasAcquired = lock.isLocked();
        });

        expect(lockWasAcquired).toBe(true);
        expect(lock.isLocked()).toBe(false);
      });
    });

    it('should track acquire and release events', () => {
      const lock = new MockSyncLock();
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        raceway.withLockSync(lock, 'test-lock', 'Mutex', () => {
          // Do work
        });

        expect(capturedEvents.length).toBe(2);
        expect(capturedEvents[0].kind).toHaveProperty('LockAcquire');
        expect(capturedEvents[1].kind).toHaveProperty('LockRelease');
      });
    });

    it('should release lock even if function throws', () => {
      const lock = new MockSyncLock();
      const middleware = raceway.middleware();
      const mockReq = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes = {};

      middleware(mockReq, mockRes, () => {
        capturedEvents.length = 0;

        expect(() => {
          raceway.withLockSync(lock, 'test-lock', 'Mutex', () => {
            throw new Error('Test error');
          });
        }).toThrow('Test error');

        expect(lock.isLocked()).toBe(false);
        expect(capturedEvents.length).toBe(2);
      });
    });

    it('should return function result', () => {
      const lock = new MockSyncLock();
      const middleware = raceway.middleware();
      const mockReq: any = { method: 'GET', url: '/api/test', headers: {} };
      const mockRes: any = {};

      let result: string | undefined;
      middleware(mockReq, mockRes, () => {
        result = raceway.withLockSync(lock, 'test-lock', 'Mutex', () => {
          return 'success';
        });
      });

      expect(result).toBe('success');
    });
  });
});
