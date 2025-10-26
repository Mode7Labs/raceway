/**
 * Raceway SDK - TypeScript/JavaScript
 *
 * Causal debugging engine for distributed systems
 */

export { Raceway } from './raceway';
export { RacewayClient } from './client';

export * from './types';
export * from './auto-track';

// Re-export runtime for Babel plugin
export { initializeRuntime } from './runtime';

// Re-export for convenience
export {
  type RacewayConfig,
  type Event,
  type EventData,
  type EventMetadata,
  type TraceContext,
  type RacewayContext,
  type UUID,
  EventKind,
} from './types';
