/**
 * Auto-tracking module using JavaScript Proxies
 *
 * This enables zero-instrumentation tracking of object property access,
 * similar to OpenTelemetry's automatic instrumentation but for race detection.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { RacewayContext } from './types';

// Re-use the context from raceway.ts
const racewayContext = new AsyncLocalStorage<RacewayContext>();

export interface AutoTrackOptions {
  /** Base path for this object (e.g., 'accounts') */
  basePath: string;
  /** Whether to track nested objects recursively */
  trackNested?: boolean;
  /** Callback to capture events */
  onAccess: (access: PropertyAccess) => void;
}

export interface PropertyAccess {
  /** Full path to the property (e.g., 'accounts.alice.balance') */
  path: string;
  /** Type of access */
  accessType: 'Read' | 'Write';
  /** Old value (for writes) */
  oldValue?: any;
  /** New value */
  newValue: any;
  /** Location in source code */
  location: string;
}

/**
 * Create a Proxy wrapper that automatically tracks property access
 */
export function createAutoTracker<T extends object>(
  target: T,
  options: AutoTrackOptions,
  currentPath: string = options.basePath
): T {
  return new Proxy(target, {
    get(obj: any, prop: string | symbol): any {
      // Skip special properties
      if (typeof prop === 'symbol' || prop === 'toJSON' || prop === 'constructor') {
        return obj[prop];
      }

      const fullPath = `${currentPath}.${String(prop)}`;
      const value = obj[prop];

      // Capture the read
      options.onAccess({
        path: fullPath,
        accessType: 'Read',
        newValue: value,
        location: captureLocation(),
      });

      // If value is an object and we're tracking nested objects, wrap it too
      if (
        options.trackNested &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        return createAutoTracker(value, options, fullPath);
      }

      return value;
    },

    set(obj: any, prop: string | symbol, value: any): boolean {
      // Skip special properties
      if (typeof prop === 'symbol') {
        obj[prop] = value;
        return true;
      }

      const fullPath = `${currentPath}.${String(prop)}`;
      const oldValue = obj[prop];

      // Perform the write
      obj[prop] = value;

      // Capture the write
      options.onAccess({
        path: fullPath,
        accessType: 'Write',
        oldValue,
        newValue: value,
        location: captureLocation(),
      });

      return true;
    },
  });
}

/**
 * Capture source code location from stack trace
 */
function captureLocation(): string {
  const err = new Error();
  const stack = err.stack || '';
  const lines = stack.split('\n');

  // Find the first line that's not in the SDK or Proxy internals
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (
      !line.includes('auto-track.ts') &&
      !line.includes('raceway.ts') &&
      !line.includes('Proxy') &&
      !line.includes('node_modules')
    ) {
      // Extract file:line from stack trace
      const match =
        line.match(/\((.+):(\d+):(\d+)\)/) || line.match(/at (.+):(\d+):(\d+)/);
      if (match) {
        return `${match[1]}:${match[2]}`;
      }
    }
  }

  return 'unknown:0';
}
