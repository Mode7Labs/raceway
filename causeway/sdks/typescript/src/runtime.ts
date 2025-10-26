/**
 * Runtime module for Babel plugin auto-instrumentation
 *
 * This module is automatically imported by code transformed with babel-plugin-raceway.
 * It provides a global Raceway instance that instrumented code can use to track events.
 *
 * Usage (automatic via Babel plugin):
 * ```typescript
 * // Your code:
 * user.balance = 100;
 *
 * // After Babel transformation:
 * import __raceway from '@mode-7/raceway-node/runtime';
 * const _oldValue = user.balance;
 * __raceway.trackStateChange('user.balance', _oldValue, 100, 'Write');
 * user.balance = 100;
 * ```
 */

import { Raceway } from './raceway';

/**
 * Global Raceway instance for Babel plugin instrumentation
 *
 * This instance is automatically configured and should not be created manually.
 * The instance is initialized lazily when first accessed.
 */
let globalRacewayInstance: Raceway | null = null;

/**
 * Initialize the global Raceway instance
 *
 * This should be called once at application startup, before any instrumented code runs.
 * If not called explicitly, a default instance will be created with environment-based config.
 *
 * @example
 * ```typescript
 * import { initializeRuntime } from '@mode-7/raceway-node/runtime';
 *
 * initializeRuntime({
 *   serverUrl: 'http://localhost:8080',
 *   serviceName: 'my-service'
 * });
 * ```
 */
export function initializeRuntime(config: {
  serverUrl: string;
  serviceName?: string;
  instanceId?: string;
  environment?: string;
  enabled?: boolean;
  batchSize?: number;
  flushInterval?: number;
  tags?: Record<string, string>;
  debug?: boolean;
}): Raceway {
  if (globalRacewayInstance) {
    console.warn('[Raceway Runtime] Runtime already initialized. Skipping re-initialization.');
    return globalRacewayInstance;
  }

  globalRacewayInstance = new Raceway(config);
  return globalRacewayInstance;
}

/**
 * Get the global Raceway instance
 *
 * If not initialized, creates a default instance using environment variables.
 */
function getRuntimeInstance(): Raceway {
  if (!globalRacewayInstance) {
    // Auto-initialize with environment variables
    const debug = process.env.RACEWAY_DEBUG === 'true';

    globalRacewayInstance = new Raceway({
      serverUrl: process.env.RACEWAY_URL || 'http://localhost:8080',
      serviceName: process.env.RACEWAY_SERVICE_NAME || 'unknown-service',
      instanceId: process.env.RACEWAY_INSTANCE_ID,
      environment: process.env.NODE_ENV || 'development',
      enabled: process.env.RACEWAY_ENABLED !== 'false',
      debug,
    });

    if (debug) {
      console.log('[Raceway Runtime] Auto-initialized with environment config');
    }
  }

  return globalRacewayInstance;
}

/**
 * Default export for Babel plugin
 *
 * This is the __raceway instance that instrumented code uses.
 */
const runtime = {
  /**
   * Track a state change (used by Babel plugin)
   */
  trackStateChange(variable: string, oldValue: any, newValue: any, accessType: 'Read' | 'Write'): void {
    const instance = getRuntimeInstance();
    instance.trackStateChange(variable, oldValue, newValue, accessType);
  },

  /**
   * Track a function call (used by Babel plugin)
   */
  captureFunctionCall(functionName: string, args: Record<string, any>, location: { file: string; line: number }): void {
    const instance = getRuntimeInstance();
    instance.trackFunctionCall(functionName, args);
  },

  /**
   * Track a custom event (used by Babel plugin)
   */
  captureCustom(name: string, data: Record<string, any>): void {
    const instance = getRuntimeInstance();
    // Use trackFunctionCall as a proxy for custom events
    instance.trackFunctionCall(name, data);
  },

  /**
   * Get the underlying Raceway instance
   */
  getInstance(): Raceway {
    return getRuntimeInstance();
  },
};

export default runtime;
