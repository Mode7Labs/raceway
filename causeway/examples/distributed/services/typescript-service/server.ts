import express from 'express';
import axios from 'axios';
// @ts-ignore - importing from local SDK
import { Raceway } from '../../../../sdks/typescript/src/raceway';

const PORT = 6001;
const SERVICE_NAME = 'typescript-service';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: SERVICE_NAME,
  instanceId: 'ts-1',
});

const app = express();
app.use(express.json());
app.use(raceway.middleware());

// Shared state requiring locks
const sharedCache: Map<string, any> = new Map();
let globalRequestCounter = 0;

// Simple lock implementation for demonstration
class SimpleLock {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

const cacheLock = new SimpleLock();
const counterLock = new SimpleLock();

app.get('/health', (req, res) => {
  res.json({ service: SERVICE_NAME, status: 'healthy' });
});


// Helper functions for granular tracking

async function incrementRequestCounter(): Promise<number> {
  // Track lock acquisition
  raceway.trackLockAcquire('global_request_counter', 'Mutex');

  await counterLock.acquire();

  try {
    // Simulate some work inside critical section
    globalRequestCounter++;
    const current = globalRequestCounter;

    raceway.trackFunctionCall('counter_incremented', {
      new_value: current,
      held_lock: 'global_request_counter'
    });

    return current;
  } finally {
    // Track lock release
    raceway.trackLockRelease('global_request_counter', 'Mutex');
    counterLock.release();
  }
}

async function checkCache(key: string): Promise<any> {
  // Track lock acquisition for read
  raceway.trackLockAcquire('shared_cache', 'RWLock-Read');

  await cacheLock.acquire();

  try {
    const value = sharedCache.get(key);

    raceway.trackFunctionCall('cache_checked', {
      key,
      found: value !== undefined,
      held_lock: 'shared_cache'
    });

    return value;
  } finally {
    raceway.trackLockRelease('shared_cache', 'RWLock-Read');
    cacheLock.release();
  }
}

async function updateCache(key: string, value: any): Promise<void> {
  // Track lock acquisition for write
  raceway.trackLockAcquire('shared_cache', 'RWLock-Write');

  await cacheLock.acquire();

  try {
    sharedCache.set(key, value);

    raceway.trackFunctionCall('cache_updated', {
      key,
      value_preview: JSON.stringify(value).substring(0, 50),
      cache_size: sharedCache.size,
      held_lock: 'shared_cache'
    });
  } finally {
    raceway.trackLockRelease('shared_cache', 'RWLock-Write');
    cacheLock.release();
  }
}

function validatePayload(payload: string): boolean {
  // Track validation start
  raceway.trackFunctionCall('validate_payload', {
    payload_length: payload?.length || 0,
    is_empty: !payload
  });

  if (!payload) {
    raceway.trackFunctionCall('validation_failed', { reason: 'empty_payload' });
    throw new Error('Payload cannot be empty');
  }

  // Track validation success
  raceway.trackStateChange('payload_validated', false, true, 'Write');
  return true;
}

function transformPayload(payload: string, servicePrefix: string): string {
  // Track transformation start
  raceway.trackFunctionCall('transform_payload', {
    input_length: payload.length,
    prefix: servicePrefix
  });

  // Track state read
  raceway.trackStateChange('input_payload', null, payload, 'Read');

  // Perform transformation
  const transformed = `${servicePrefix} → ${payload}`;

  // Track state write
  raceway.trackStateChange('transformed_payload', null, transformed, 'Write');

  // Track transformation complete
  raceway.trackFunctionCall('transform_payload:return', {
    output_length: transformed.length,
    transformation_success: true
  });

  return transformed;
}

function prepareDownstreamRequest(
  downstream: string,
  payload: string,
  nextDownstream?: string,
  nextNextDownstream?: string
) {
  // Track request preparation
  raceway.trackFunctionCall('prepare_downstream_request', {
    url: downstream,
    has_next_downstream: !!nextDownstream,
    has_next_next_downstream: !!nextNextDownstream
  });

  const requestData = {
    payload,
    downstream: nextDownstream,
    next_downstream: nextNextDownstream
  };

  // Track request data prepared
  raceway.trackStateChange('downstream_request_ready', false, true, 'Write');

  return requestData;
}

async function makeDownstreamCall(
  downstream: string,
  requestData: any
): Promise<any> {
  // Track HTTP request start
  raceway.trackFunctionCall('http_request_start', {
    url: downstream,
    method: 'POST'
  });

  const startTime = Date.now();

  try {
    // Get propagation headers
    const headers = raceway.propagationHeaders();

    // Track header propagation
    raceway.trackFunctionCall('propagate_trace_headers', {
      header_count: Object.keys(headers).length,
      has_traceparent: 'traceparent' in headers,
      has_clock: 'raceway-clock' in headers
    });

    // Make the actual request
    const response = await axios.post(downstream, requestData, {
      headers,
      timeout: 10000
    });

    const durationMs = Date.now() - startTime;

    // Track response received
    raceway.trackFunctionCall('downstream_response_received', {
      status: response.status,
      success: response.status >= 200 && response.status < 300,
      duration_ms: durationMs,
      has_data: !!response.data
    });

    // Track response data
    raceway.trackStateChange('downstream_response', null,
      JSON.stringify(response.data).substring(0, 100), 'Read');

    return response.data;

  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    // Track error type
    const errorType = error.code || error.name || 'UnknownError';
    const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');

    if (isTimeout) {
      // Track timeout
      raceway.trackFunctionCall('downstream_timeout', {
        url: downstream,
        duration_ms: durationMs
      });
    } else {
      // Track other errors
      raceway.trackFunctionCall('downstream_error', {
        url: downstream,
        error: error.message,
        error_type: errorType,
        duration_ms: durationMs
      });
    }

    throw error;
  }
}

function buildResponse(
  payload: string,
  receivedHeaders: any,
  downstreamResponse: any
) {
  // Track response building
  raceway.trackFunctionCall('build_response', {
    has_downstream: !!downstreamResponse,
    header_count: Object.keys(receivedHeaders).length
  });

  const responseData = {
    service: SERVICE_NAME,
    receivedHeaders,
    payload,
    downstream: downstreamResponse,
  };

  // Track response ready
  raceway.trackStateChange('response_ready', false, true, 'Write');

  return responseData;
}


app.post('/process', async (req, res) => {
  // Track request received
  raceway.trackFunctionCall('process_endpoint_called', {
    method: req.method,
    has_body: !!req.body,
    content_type: req.get('content-type')
  });

  // Increment global request counter with lock tracking
  const requestNum = await incrementRequestCounter();

  raceway.trackStateChange('requestCount', null, 1, 'Write');

  const { downstream, payload, next_downstream } = req.body;

  // Track payload received
  raceway.trackStateChange('received_payload', null, payload, 'Read');

  // Check cache for this payload (with lock tracking)
  const cacheKey = `payload:${payload}`;
  const cached = await checkCache(cacheKey);

  try {
    // Validate payload (granular tracking)
    validatePayload(payload);

    // Transform payload (granular tracking)
    const transformedPayload = transformPayload(payload, SERVICE_NAME);

    let downstreamResponse = null;

    // Call downstream service if specified
    if (downstream) {
      // Track decision to call downstream
      raceway.trackFunctionCall('calling_downstream', { url: downstream });

      try {
        // Prepare request (granular tracking)
        const requestData = prepareDownstreamRequest(
          downstream,
          transformedPayload,
          next_downstream,
          req.body.next_next_downstream
        );

        // Make downstream call (granular tracking)
        downstreamResponse = await makeDownstreamCall(downstream, requestData);

        // Track successful downstream call
        raceway.trackStateChange('downstream_success', false, true, 'Write');

      } catch (error: any) {
        // Track downstream failure
        raceway.trackFunctionCall('downstream_call_failed', {
          error: error.message,
          error_type: error.constructor.name
        });
        console.error(`Error calling downstream: ${error.message}`);
        // Continue processing even if downstream fails
      }
    } else {
      // Track no downstream call
      raceway.trackFunctionCall('no_downstream_specified', {});
    }

    // Build response (granular tracking)
    const receivedHeaders = {
      traceparent: req.headers['traceparent'],
      'raceway-clock': req.headers['raceway-clock'],
    };
    const responseData = buildResponse(payload, receivedHeaders, downstreamResponse);

    // Update cache with result (with lock tracking)
    await updateCache(cacheKey, {
      payload: transformedPayload,
      timestamp: new Date().toISOString(),
      request_num: requestNum
    });

    // Track successful processing
    raceway.trackStateChange('request_processed', false, true, 'Write');

    res.json(responseData);

  } catch (error: any) {
    // Track processing error
    raceway.trackFunctionCall('processing_error', {
      error: error.message,
      error_type: error.constructor.name
    });

    res.status(500).json({
      error: 'Processing failed',
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
  console.log(`Enhanced with granular tracking (function calls, state changes)`);
});
