import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { RacewayContext, UUID } from './types';

const TRACEPARENT_HEADER = 'traceparent';
const TRACESTATE_HEADER = 'tracestate';
const RACEWAY_CLOCK_HEADER = 'raceway-clock';
const TRACEPARENT_VERSION = '00';
const DEFAULT_TRACE_FLAGS = '01';
const CLOCK_VERSION_PREFIX = 'v1;';

type IncomingHeaders = Record<string, string | string[] | undefined>;

export interface ParsedTraceHeaders {
  traceId: UUID;
  spanId: string;
  parentSpanId: string | null;
  tracestate: string | null;
  clockVector: Array<[string, number]>;
  distributed: boolean;
}

export interface PropagationHeaders {
  headers: Record<string, string>;
  childSpanId: string;
  clockVector: Array<[string, number]>;
}

export function parseIncomingTraceHeaders(
  headers: IncomingHeaders,
  defaults: { serviceName: string; instanceId: string }
): ParsedTraceHeaders {
  const traceparentRaw = getHeader(headers, TRACEPARENT_HEADER);
  const tracestateRaw = getHeader(headers, TRACESTATE_HEADER);
  const racewayClockRaw = getHeader(headers, RACEWAY_CLOCK_HEADER);

  let traceId = uuidv4();
  let spanId: string | null = null;
  let parentSpanId: string | null = null;
  let distributed = false;

  if (traceparentRaw) {
    const parsed = parseTraceParent(traceparentRaw);
    if (parsed) {
      traceId = parsed.traceId;
      spanId = parsed.parentSpanId; // This is the span ID for THIS service
      distributed = true;
    }
  }

  let clockVector: Array<[string, number]> = [];
  if (racewayClockRaw) {
    const parsed = parseRacewayClock(racewayClockRaw);
    if (parsed) {
      clockVector = parsed.clockVector;
      distributed = true;
      // Raceway clock has more accurate span IDs
      if (parsed.spanId) {
        spanId = parsed.spanId;
      }
      if (parsed.parentSpanId) {
        parentSpanId = parsed.parentSpanId;
      }
      if (parsed.traceId) {
        traceId = parsed.traceId;
      }
    }
  }

  // Ensure local component exists in vector clock
  const componentId = makeClockComponent(defaults.serviceName, defaults.instanceId);
  const hasComponent = clockVector.some(([id]) => id === componentId);
  if (!hasComponent) {
    clockVector = [...clockVector, [componentId, 0]];
  }

  return {
    traceId,
    spanId: spanId || generateSpanId(), // Use received span ID, or generate if not provided
    parentSpanId,
    tracestate: tracestateRaw ?? null,
    clockVector,
    distributed,
  };
}

export function buildPropagationHeaders(
  ctx: RacewayContext,
  options: { serviceName: string; instanceId: string }
): PropagationHeaders {
  const traceIdHex = uuidToTraceParent(ctx.traceId);
  const childSpanId = generateSpanId();
  const traceparent = `${TRACEPARENT_VERSION}-${traceIdHex}-${childSpanId}-${DEFAULT_TRACE_FLAGS}`;

  const clockVector = incrementClockVector(ctx.clockVector, options);
  const payload = {
    trace_id: ctx.traceId,
    span_id: childSpanId,
    parent_span_id: ctx.spanId,
    service: options.serviceName,
    instance: options.instanceId,
    clock: clockVector,
  };
  const racewayClock = CLOCK_VERSION_PREFIX + encodeBase64Url(JSON.stringify(payload));

  const headers: Record<string, string> = {
    [TRACEPARENT_HEADER]: traceparent,
    [RACEWAY_CLOCK_HEADER]: racewayClock,
  };

  if (ctx.tracestate) {
    headers[TRACESTATE_HEADER] = ctx.tracestate;
  }

  return {
    headers,
    childSpanId,
    clockVector,
  };
}

export function incrementClockVector(
  vector: Array<[string, number]>,
  options: { serviceName: string; instanceId: string }
): Array<[string, number]> {
  const component = makeClockComponent(options.serviceName, options.instanceId);
  let updated = false;

  const next = vector.map(([id, value]) => {
    if (id === component) {
      updated = true;
      return [id, value + 1] as [string, number];
    }
    return [id, value] as [string, number];
  });

  if (!updated) {
    next.push([component, 1]);
  }

  return next;
}

function parseTraceParent(value: string): { traceId: UUID; parentSpanId: string } | null {
  const parts = value.trim().split('-');
  if (parts.length !== 4) {
    return null;
  }

  const [, traceIdHex, spanIdHex] = parts;
  if (!isHex(traceIdHex, 32) || !isHex(spanIdHex, 16)) {
    return null;
  }

  return {
    traceId: traceParentToUuid(traceIdHex),
    parentSpanId: spanIdHex.toLowerCase(),
  };
}

function parseRacewayClock(
  value: string
): { traceId: UUID | null; spanId: string | null; parentSpanId: string | null; clockVector: Array<[string, number]> } | null {
  if (!value.startsWith(CLOCK_VERSION_PREFIX)) {
    return null;
  }

  const encoded = value.substring(CLOCK_VERSION_PREFIX.length);
  try {
    const json = decodeBase64Url(encoded);
    const payload = JSON.parse(json);
    const clockVector: Array<[string, number]> = Array.isArray(payload.clock)
      ? payload.clock
          .filter(
            (item: unknown) =>
              Array.isArray(item) &&
              item.length === 2 &&
              typeof item[0] === 'string' &&
              typeof item[1] === 'number'
          )
          .map(([id, value]: [string, number]) => [id, value])
      : [];

    return {
      traceId: typeof payload.trace_id === 'string' ? payload.trace_id : null,
      spanId: typeof payload.span_id === 'string' ? payload.span_id : null,
      parentSpanId: typeof payload.parent_span_id === 'string' ? payload.parent_span_id : null,
      clockVector,
    };
  } catch (error) {
    return null;
  }
}

function makeClockComponent(service: string, instance: string): string {
  return `${service}#${instance}`;
}

function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

function uuidToTraceParent(uuid: UUID): string {
  return uuid.replace(/-/g, '').padStart(32, '0').slice(0, 32);
}

function traceParentToUuid(hex: string): UUID {
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20, 32)
  );
}

function isHex(value: string, expectedLength: number): boolean {
  return value.length === expectedLength && /^[0-9a-f]+$/i.test(value);
}

function getHeader(headers: IncomingHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}
