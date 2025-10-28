import sys
import os
import signal
import atexit
import time

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../../../sdks/python'))

from flask import Flask, request, jsonify
import requests
from threading import Lock
from raceway import RacewayClient, Config, track_function
from raceway.middleware import flask_middleware
from raceway.lock_helpers import tracked_lock

PORT = 6002
SERVICE_NAME = 'python-service'

client = RacewayClient(Config(
    endpoint='http://localhost:8080',
    service_name=SERVICE_NAME,
    instance_id='py-1'
))

# Shared state requiring locks
shared_cache = {}
global_request_counter = 0

# Locks for protecting shared state
cache_lock = Lock()
counter_lock = Lock()

# Register shutdown handlers to flush events
def shutdown_handler(signum=None, frame=None):
    print(f"[{SERVICE_NAME}] Shutting down, flushing events...", flush=True)
    client.shutdown()
    sys.exit(0)

signal.signal(signal.SIGTERM, shutdown_handler)
signal.signal(signal.SIGINT, shutdown_handler)
atexit.register(client.shutdown)

app = Flask(__name__)

@app.before_request
def init_raceway():
    flask_middleware(client).before_request()

@app.after_request
def finish_raceway(response):
    return flask_middleware(client).after_request(response)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'service': SERVICE_NAME, 'status': 'healthy'})


# Helper functions with decorators for auto-tracking

def increment_request_counter():
    """Increment global request counter with lock tracking"""
    global global_request_counter

    with tracked_lock(client, counter_lock, 'global_request_counter', 'Mutex'):
        # Simulate some work inside critical section
        global_request_counter += 1
        current = global_request_counter

        client.track_function_call('counter_incremented', {
            'new_value': current,
            'held_lock': 'global_request_counter'
        })

        return current


def check_cache(key):
    """Check shared cache with lock tracking (read operation)"""
    with tracked_lock(client, cache_lock, 'shared_cache', 'RWLock-Read'):
        value = shared_cache.get(key)

        client.track_function_call('cache_checked', {
            'key': key,
            'found': value is not None,
            'held_lock': 'shared_cache'
        })

        return value


def update_cache(key, value):
    """Update shared cache with lock tracking (write operation)"""
    with tracked_lock(client, cache_lock, 'shared_cache', 'RWLock-Write'):
        shared_cache[key] = value

        client.track_function_call('cache_updated', {
            'key': key,
            'value_preview': str(value)[:50],
            'cache_size': len(shared_cache),
            'held_lock': 'shared_cache'
        })


@track_function(client, capture_args=True)
def validate_payload(payload):
    """Validate incoming payload"""
    if not payload:
        raise ValueError("Payload cannot be empty")

    # Track validation step
    client.track_state_change('payload_validated', False, True, 'Write')
    return True


@track_function(client, capture_args=True, capture_result=True)
def transform_payload(payload, service_prefix):
    """Transform payload by adding service prefix"""
    # Track state read
    client.track_state_change('input_payload', None, payload, 'Read')

    # Perform transformation
    transformed = f"{service_prefix} → {payload}"

    # Track state write
    client.track_state_change('transformed_payload', None, transformed, 'Write')

    return transformed


@track_function(client, capture_args=True)
def prepare_downstream_request(downstream_url, payload, next_downstream, next_next_downstream):
    """Prepare request data for downstream service"""
    request_data = {
        'payload': payload,
        'downstream': next_downstream,
        'next_downstream': next_next_downstream
    }

    # Track request preparation
    client.track_function_call('downstream_request_prepared', {
        'url': downstream_url,
        'has_next_downstream': next_downstream is not None
    })

    return request_data


@track_function(client, name='call_downstream_service')
def make_downstream_call(downstream_url, request_data):
    """Make HTTP call to downstream service"""
    # Track HTTP request start
    client.track_function_call('http_request_start', {'url': downstream_url, 'method': 'POST'})

    start_time = time.time()

    try:
        # Get propagation headers
        headers = client.propagation_headers()

        # Track header propagation
        client.track_function_call('propagate_trace_headers', {
            'header_count': len(headers),
            'has_traceparent': 'traceparent' in headers,
            'has_clock': 'raceway-clock' in headers
        })

        # Make the actual request
        response = requests.post(
            downstream_url,
            json=request_data,
            headers=headers,
            timeout=10
        )

        # Track response received
        duration_ms = (time.time() - start_time) * 1000
        client.track_function_call('downstream_response_received', {
            'status': response.status_code,
            'success': response.ok,
            'duration_ms': duration_ms
        })

        return response.json()

    except requests.Timeout:
        # Track timeout
        duration_ms = (time.time() - start_time) * 1000
        client.track_function_call('downstream_timeout', {
            'url': downstream_url,
            'duration_ms': duration_ms
        })
        raise

    except requests.RequestException as e:
        # Track error
        duration_ms = (time.time() - start_time) * 1000
        client.track_function_call('downstream_error', {
            'url': downstream_url,
            'error': str(e),
            'duration_ms': duration_ms
        })
        raise


@track_function(client, capture_args=True)
def build_response(payload, downstream_response):
    """Build final response object"""
    response_data = {
        'service': SERVICE_NAME,
        'receivedHeaders': {
            'traceparent': request.headers.get('traceparent'),
            'raceway-clock': request.headers.get('raceway-clock'),
        },
        'payload': payload,
        'downstream': downstream_response,
    }

    # Track response built
    client.track_state_change('response_ready', False, True, 'Write')

    return response_data


@app.route('/process', methods=['POST'])
def process():
    """Main processing endpoint with comprehensive tracking"""
    # Track request received
    client.track_function_call('process_endpoint_called', {
        'method': request.method,
        'has_json': request.is_json
    })

    # Increment global request counter with lock tracking
    request_num = increment_request_counter()

    # Increment request counter
    client.track_state_change('request_count', None, 1, 'Write')

    # Parse request data
    data = request.get_json() or {}
    downstream = data.get('downstream')
    payload = data.get('payload', '')

    # Track payload received
    client.track_state_change('received_payload', None, payload, 'Read')

    # Check cache for this payload (with lock tracking)
    cache_key = f'payload:{payload}'
    cached = check_cache(cache_key)

    try:
        # Validate payload (auto-tracked with decorator)
        validate_payload(payload)

        # Transform payload (auto-tracked with decorator)
        transformed_payload = transform_payload(payload, SERVICE_NAME)

        downstream_response = None

        # Call downstream service if specified
        if downstream:
            # Track decision to call downstream
            client.track_function_call('calling_downstream', {'url': downstream})

            try:
                # Prepare request (auto-tracked with decorator)
                request_data = prepare_downstream_request(
                    downstream,
                    transformed_payload,
                    data.get('next_downstream'),
                    data.get('next_next_downstream')
                )

                # Make downstream call (auto-tracked with decorator)
                downstream_response = make_downstream_call(downstream, request_data)

                # Track successful downstream call
                client.track_state_change('downstream_success', False, True, 'Write')

            except Exception as e:
                # Track downstream failure
                client.track_function_call('downstream_call_failed', {
                    'error': str(e),
                    'error_type': type(e).__name__
                })
                print(f"Error calling downstream: {e}")
                # Continue processing even if downstream fails
        else:
            # Track no downstream call
            client.track_function_call('no_downstream_specified', {})

        # Build response (auto-tracked with decorator)
        response_data = build_response(payload, downstream_response)

        # Update cache with result (with lock tracking)
        import datetime
        update_cache(cache_key, {
            'payload': transformed_payload,
            'timestamp': datetime.datetime.utcnow().isoformat(),
            'request_num': request_num
        })

        # Track successful processing
        client.track_state_change('request_processed', False, True, 'Write')

        return jsonify(response_data)

    except ValueError as e:
        # Track validation error
        client.track_function_call('validation_error', {'error': str(e)})
        return jsonify({'error': 'Validation failed', 'details': str(e)}), 400

    except Exception as e:
        # Track unexpected error
        client.track_function_call('processing_error', {
            'error': str(e),
            'error_type': type(e).__name__
        })
        return jsonify({'error': 'Processing failed', 'details': str(e)}), 500


if __name__ == '__main__':
    print(f"{SERVICE_NAME} listening on port {PORT}")
    print(f"Enhanced with @track_function decorators and comprehensive tracking")
    app.run(host='0.0.0.0', port=PORT, debug=False)
