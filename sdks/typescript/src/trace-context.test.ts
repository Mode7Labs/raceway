import {
  parseIncomingTraceHeaders,
  buildPropagationHeaders,
  incrementClockVector,
  ParsedTraceHeaders,
} from './trace-context';
import { RacewayContext } from './types';

const VALID_TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const VALID_TRACE_ID = '0af76519-16cd-43dd-8448-eb211c80319c';
const VALID_SPAN_ID = 'b7ad6b7169203331';

describe('trace-context', () => {
  describe('parseIncomingTraceHeaders', () => {
    const defaults = { serviceName: 'test-service', instanceId: 'instance-1' };

    it('should parse valid W3C traceparent header', () => {
      const headers = {
        traceparent: VALID_TRACEPARENT,
      };

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.spanId).toBe(VALID_SPAN_ID);
      expect(result.parentSpanId).toBeNull();
      expect(result.distributed).toBe(true);
    });

    it('should parse valid raceway-clock header', () => {
      const clockPayload = {
        trace_id: VALID_TRACE_ID,
        span_id: VALID_SPAN_ID,
        parent_span_id: 'parent-span-1111',
        service: 'upstream-service',
        instance: 'upstream-1',
        clock: [
          ['upstream-service#upstream-1', 5],
          ['other-service#other-1', 3],
        ],
      };
      const encoded = Buffer.from(JSON.stringify(clockPayload)).toString('base64url');
      const headers = {
        'raceway-clock': `v1;${encoded}`,
      };

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.spanId).toBe(VALID_SPAN_ID);
      expect(result.parentSpanId).toBe('parent-span-1111');
      expect(result.distributed).toBe(true);
      expect(result.clockVector).toContainEqual(['upstream-service#upstream-1', 5]);
      expect(result.clockVector).toContainEqual(['other-service#other-1', 3]);
    });

    it('should combine traceparent and raceway-clock headers', () => {
      const clockPayload = {
        trace_id: VALID_TRACE_ID,
        span_id: VALID_SPAN_ID,
        parent_span_id: 'upstream-parent',
        service: 'upstream',
        instance: 'up-1',
        clock: [['upstream#up-1', 10]],
      };
      const encoded = Buffer.from(JSON.stringify(clockPayload)).toString('base64url');
      const headers = {
        traceparent: VALID_TRACEPARENT,
        'raceway-clock': `v1;${encoded}`,
      };

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.spanId).toBe(VALID_SPAN_ID);
      expect(result.parentSpanId).toBe('upstream-parent');
      expect(result.distributed).toBe(true);
      expect(result.clockVector).toContainEqual(['upstream#up-1', 10]);
    });

    it('should generate new trace when no headers present', () => {
      const headers = {};

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(result.parentSpanId).toBeNull();
      expect(result.distributed).toBe(false);
      expect(result.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should initialize local clock component when missing', () => {
      const headers = {};

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.clockVector).toContainEqual(['test-service#instance-1', 0]);
    });

    it('should preserve existing local clock component', () => {
      const clockPayload = {
        trace_id: VALID_TRACE_ID,
        span_id: VALID_SPAN_ID,
        parent_span_id: null,
        service: 'test-service',
        instance: 'instance-1',
        clock: [['test-service#instance-1', 42]],
      };
      const encoded = Buffer.from(JSON.stringify(clockPayload)).toString('base64url');
      const headers = {
        'raceway-clock': `v1;${encoded}`,
      };

      const result = parseIncomingTraceHeaders(headers, defaults);

      const localComponent = result.clockVector.find(
        ([id]) => id === 'test-service#instance-1'
      );
      expect(localComponent).toEqual(['test-service#instance-1', 42]);
    });

    it('should handle malformed traceparent gracefully', () => {
      const headers = {
        traceparent: 'invalid-format',
      };

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.distributed).toBe(false);
      expect(result.parentSpanId).toBeNull();
    });

    it('should handle malformed raceway-clock gracefully', () => {
      const headers = {
        'raceway-clock': 'v1;invalid-base64!!!',
      };

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.distributed).toBe(false);
      expect(result.clockVector).toHaveLength(1);
      expect(result.clockVector[0][0]).toBe('test-service#instance-1');
    });

    it('should handle wrong version prefix in raceway-clock', () => {
      const clockPayload = { clock: [['service#1', 1]] };
      const encoded = Buffer.from(JSON.stringify(clockPayload)).toString('base64url');
      const headers = {
        'raceway-clock': `v99;${encoded}`,
      };

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.distributed).toBe(false);
    });

    it('should parse tracestate header', () => {
      const headers = {
        traceparent: VALID_TRACEPARENT,
        tracestate: 'congo=t61rcWkgMzE,rojo=00f067aa0ba902b7',
      };

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.tracestate).toBe('congo=t61rcWkgMzE,rojo=00f067aa0ba902b7');
    });

    it('should handle array-valued headers', () => {
      const headers = {
        traceparent: [VALID_TRACEPARENT, 'another-value'],
      };

      const result = parseIncomingTraceHeaders(headers, defaults);

      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.distributed).toBe(true);
    });
  });

  describe('buildPropagationHeaders', () => {
    const options = { serviceName: 'test-service', instanceId: 'instance-1' };

    const createTestContext = (overrides: Partial<RacewayContext> = {}): RacewayContext => ({
      traceId: VALID_TRACE_ID,
      threadId: 'thread-1',
      parentId: null,
      rootId: null,
      clock: 0,
      spanId: 'current-span-id',
      parentSpanId: null,
      distributed: false,
      clockVector: [],
      tracestate: null,
      ...overrides,
    });

    it('should build valid traceparent header', () => {
      const ctx = createTestContext();

      const result = buildPropagationHeaders(ctx, options);

      expect(result.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(result.headers.traceparent).toContain(
        VALID_TRACE_ID.replace(/-/g, '').padStart(32, '0').slice(0, 32)
      );
    });

    it('should build valid raceway-clock header', () => {
      const ctx = createTestContext({
        clockVector: [['test-service#instance-1', 5]],
      });

      const result = buildPropagationHeaders(ctx, options);

      expect(result.headers['raceway-clock']).toMatch(/^v1;[A-Za-z0-9_-]+$/);

      // Decode and verify payload
      const encoded = result.headers['raceway-clock'].substring(3);
      const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));

      expect(decoded.trace_id).toBe(VALID_TRACE_ID);
      expect(decoded.parent_span_id).toBe('current-span-id');
      expect(decoded.service).toBe('test-service');
      expect(decoded.instance).toBe('instance-1');
      expect(decoded.clock).toContainEqual(['test-service#instance-1', 6]);
    });

    it('should generate new child span ID', () => {
      const ctx = createTestContext({
        spanId: 'parent-span',
      });

      const result = buildPropagationHeaders(ctx, options);

      expect(result.childSpanId).toMatch(/^[0-9a-f]{16}$/);
      expect(result.childSpanId).not.toBe('parent-span');
    });

    it('should include tracestate when present', () => {
      const ctx = createTestContext({
        tracestate: 'vendor=value',
      });

      const result = buildPropagationHeaders(ctx, options);

      expect(result.headers.tracestate).toBe('vendor=value');
    });

    it('should increment clock vector', () => {
      const ctx = createTestContext({
        clockVector: [
          ['test-service#instance-1', 10],
          ['other-service#other-1', 5],
        ],
      });

      const result = buildPropagationHeaders(ctx, options);

      expect(result.clockVector).toContainEqual(['test-service#instance-1', 11]);
      expect(result.clockVector).toContainEqual(['other-service#other-1', 5]);
    });
  });

  describe('incrementClockVector', () => {
    const options = { serviceName: 'my-service', instanceId: 'inst-1' };

    it('should increment existing component', () => {
      const vector: Array<[string, number]> = [['my-service#inst-1', 5]];

      const result = incrementClockVector(vector, options);

      expect(result).toContainEqual(['my-service#inst-1', 6]);
    });

    it('should add new component when not present', () => {
      const vector: Array<[string, number]> = [['other-service#other', 3]];

      const result = incrementClockVector(vector, options);

      expect(result).toContainEqual(['my-service#inst-1', 1]);
      expect(result).toContainEqual(['other-service#other', 3]);
    });

    it('should handle empty vector', () => {
      const vector: Array<[string, number]> = [];

      const result = incrementClockVector(vector, options);

      expect(result).toEqual([['my-service#inst-1', 1]]);
    });

    it('should not mutate original vector', () => {
      const vector: Array<[string, number]> = [['my-service#inst-1', 5]];
      const original = [...vector];

      incrementClockVector(vector, options);

      expect(vector).toEqual(original);
    });

    it('should preserve other components unchanged', () => {
      const vector: Array<[string, number]> = [
        ['service-a#1', 10],
        ['my-service#inst-1', 5],
        ['service-b#2', 7],
      ];

      const result = incrementClockVector(vector, options);

      expect(result).toContainEqual(['service-a#1', 10]);
      expect(result).toContainEqual(['my-service#inst-1', 6]);
      expect(result).toContainEqual(['service-b#2', 7]);
    });
  });

  describe('end-to-end scenarios', () => {
    const createTestContext = (overrides: Partial<RacewayContext> = {}): RacewayContext => ({
      traceId: VALID_TRACE_ID,
      threadId: 'thread-1',
      parentId: null,
      rootId: null,
      clock: 0,
      spanId: 'current-span-id',
      parentSpanId: null,
      distributed: false,
      clockVector: [],
      tracestate: null,
      ...overrides,
    });

    it('should support full request flow', () => {
      // Service A receives request
      const incomingHeaders = {
        traceparent: VALID_TRACEPARENT,
      };

      const parsed = parseIncomingTraceHeaders(incomingHeaders, {
        serviceName: 'service-a',
        instanceId: 'a1',
      });

      // Service A creates context
      const contextA = createTestContext({
        traceId: parsed.traceId,
        spanId: parsed.spanId,
        clockVector: parsed.clockVector,
        tracestate: parsed.tracestate,
      });

      // Service A calls Service B
      const outgoingHeaders = buildPropagationHeaders(contextA, {
        serviceName: 'service-a',
        instanceId: 'a1',
      });

      // Service B receives request
      const parsedB = parseIncomingTraceHeaders(outgoingHeaders.headers, {
        serviceName: 'service-b',
        instanceId: 'b1',
      });

      // Verify trace continuity
      expect(parsedB.traceId).toBe(parsed.traceId);
      expect(parsedB.spanId).toBe(outgoingHeaders.childSpanId);
      expect(parsedB.parentSpanId).toBe(contextA.spanId);
      expect(parsedB.distributed).toBe(true);

      // Verify clock propagation
      expect(parsedB.clockVector).toContainEqual(['service-a#a1', 1]);
      expect(parsedB.clockVector).toContainEqual(['service-b#b1', 0]);
    });

    it('should support multi-hop propagation', () => {
      // Service A (initial)
      const ctxA = createTestContext({
        spanId: 'span-a',
        clockVector: [['service-a#a1', 0]],
      });

      // A → B
      const headersAB = buildPropagationHeaders(ctxA, {
        serviceName: 'service-a',
        instanceId: 'a1',
      });

      const parsedB = parseIncomingTraceHeaders(headersAB.headers, {
        serviceName: 'service-b',
        instanceId: 'b1',
      });

      const ctxB = createTestContext({
        traceId: parsedB.traceId,
        spanId: parsedB.spanId,
        clockVector: parsedB.clockVector,
        tracestate: parsedB.tracestate,
      });

      // B → C
      const headersBC = buildPropagationHeaders(ctxB, {
        serviceName: 'service-b',
        instanceId: 'b1',
      });

      const parsedC = parseIncomingTraceHeaders(headersBC.headers, {
        serviceName: 'service-c',
        instanceId: 'c1',
      });

      // Verify full chain
      expect(parsedC.traceId).toBe(VALID_TRACE_ID);
      expect(parsedC.clockVector).toContainEqual(['service-a#a1', 1]);
      expect(parsedC.clockVector).toContainEqual(['service-b#b1', 1]);
      expect(parsedC.clockVector).toContainEqual(['service-c#c1', 0]);
    });
  });
});
