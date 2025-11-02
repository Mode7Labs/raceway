# Python SDK

Official Python SDK for Raceway - Race condition detection and distributed tracing for Python applications.

## Features

- Automatic context propagation using contextvars
- Flask and FastAPI middleware support
- Manual instrumentation API
- Distributed tracing across service boundaries (W3C Trace Context)
- Race condition and concurrency bug detection
- Automatic batching and background flushing

## Installation

```bash
pip install raceway
```

## Quick Start

### Flask Integration

```python
from flask import Flask, request
from raceway import RacewayClient, Config
from raceway.middleware import flask_middleware

app = Flask(__name__)

# Initialize client
raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="my-service",
    instance_id="instance-1"
))

# Add middleware
middleware = flask_middleware(raceway)

@app.before_request
def init_raceway():
    middleware.before_request()

@app.after_request
def finish_raceway(response):
    return middleware.after_request(response)

@app.route("/transfer", methods=["POST"])
def transfer():
    data = request.get_json()

    raceway.track_function_call("transfer", data)

    # Track state changes
    balance = accounts[data["from"]]["balance"]
    raceway.track_state_change(
        f"{data['from']}.balance",
        None,
        balance,
        "Read"
    )

    accounts[data["from"]]["balance"] -= data["amount"]
    raceway.track_state_change(
        f"{data['from']}.balance",
        balance,
        accounts[data["from"]]["balance"],
        "Write"
    )

    return {"success": True}

if __name__ == "__main__":
    app.run(port=3000, threaded=True)
```

### FastAPI Integration

```python
from fastapi import FastAPI, Request
from raceway import RacewayClient, Config
from raceway.middleware import fastapi_middleware

app = FastAPI()

raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="my-service"
))

# Add middleware
app.middleware("http")(fastapi_middleware(raceway))

@app.post("/transfer")
async def transfer(request: Request):
    data = await request.json()

    raceway.track_function_call("transfer", data)

    # Your logic here

    return {"success": True}
```

## Distributed Tracing

The SDK implements W3C Trace Context and Raceway vector clocks for distributed tracing across services.

### Propagating Trace Context

Use `propagation_headers()` when calling downstream services:

```python
import requests
from flask import Flask
from raceway import RacewayClient, Config

app = Flask(__name__)
raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="api-gateway"
))

@app.route("/checkout", methods=["POST"])
def checkout():
    order_id = request.get_json()["orderId"]

    # Get propagation headers
    headers = raceway.propagation_headers()

    # Call downstream services
    inventory_result = requests.post(
        "http://inventory-service/reserve",
        json={"orderId": order_id},
        headers=headers
    )

    payment_result = requests.post(
        "http://payment-service/charge",
        json={"orderId": order_id},
        headers=headers
    )

    return {"success": True}
```

### What Gets Propagated

The middleware automatically:
- Parses incoming `traceparent`, `tracestate`, and `raceway-clock` headers
- Generates new span IDs for this service
- Returns headers for downstream calls via `propagation_headers()`

Headers propagated:
- `traceparent`: W3C Trace Context (trace ID, span ID, trace flags)
- `tracestate`: W3C vendor-specific state
- `raceway-clock`: Raceway vector clock for causality tracking

### Cross-Service Trace Merging

Events from all services sharing the same trace ID are automatically merged by the Raceway backend. The backend recursively follows distributed edges to construct complete traces across arbitrary service chain lengths.

## Authentication

If your Raceway server is configured with API key authentication, provide the key when initializing the SDK:

```python
import os
from raceway import RacewayClient, Config

raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="my-service",
    api_key=os.environ.get("RACEWAY_API_KEY")  # Read from environment variable
))
```

**Best Practices:**
- Store API keys in environment variables, never hardcode them
- Use different keys for different environments (dev, staging, production)
- Rotate keys periodically for security
- The SDK will include the API key in the `Authorization` header: `Bearer <your-api-key>`

**Without Authentication:**

If your Raceway server doesn't require authentication, simply omit the `api_key` parameter:

```python
raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="my-service"
))
```

### Using the Request Wrapper

For convenience, use the `request()` wrapper that automatically adds propagation headers:

```python
# Instead of:
headers = raceway.propagation_headers()
requests.post(url, json=data, headers=headers)

# Use:
response = raceway.request("POST", url, json=data)
```

## Configuration

```python
from dataclass import dataclass
from typing import Optional

@dataclass
class Config:
    endpoint: str = "http://localhost:8080"       # Raceway server URL
    service_name: str = "unknown-service"         # Service name
    instance_id: Optional[str] = None             # Instance ID (default: hostname-PID)
    environment: str = "development"              # Environment
    batch_size: int = 50                          # Event batch size
    flush_interval: float = 1.0                   # Flush interval in seconds
    debug: bool = False                           # Debug mode
```

## API Reference

### Core Tracking Methods

All tracking methods use the current context (set by middleware).

#### `track_state_change(variable, old_value, new_value, access_type)`

Track a variable read or write.

```python
# Track a read
raceway.track_state_change("counter", None, 5, "Read")

# Track a write
raceway.track_state_change("counter", 5, 6, "Write")
```

#### `track_function_call(function_name, args)`

Track a function call.

```python
raceway.track_function_call("process_payment", {
    "userId": 123,
    "amount": 50
})
```

#### `track_http_request(method, url, headers=None, body=None)`

Track an HTTP request (automatically called by middleware).

```python
raceway.track_http_request("POST", "/api/users")
```

#### `track_http_response(status, headers=None, body=None, duration_ms=0)`

Track an HTTP response.

```python
raceway.track_http_response(200, duration_ms=45)
```

### Distributed Tracing Methods

#### `propagation_headers(extra_headers=None)`

Generate headers for downstream service calls.

```python
headers = raceway.propagation_headers({"x-custom": "value"})
requests.post("http://downstream/api", headers=headers, json=data)
```

**Returns:** Dictionary with `traceparent`, `tracestate`, and `raceway-clock` headers.

**Raises:** `RuntimeError` if called outside request context.

#### `request(method, url, **kwargs)`

Convenience wrapper around `requests.request` that automatically adds propagation headers.

```python
response = raceway.request("POST", "http://downstream/api", json=data)
```

### Lifecycle Methods

#### `shutdown()`

Flush remaining events and stop background thread.

```python
raceway.shutdown()
```

## Context Propagation

The SDK uses Python's `contextvars` for automatic context propagation across:

- HTTP requests
- Async operations (asyncio)
- Thread pools (with proper context copying)

The middleware handles context initialization automatically.

## Best Practices

1. **Use middleware**: Set up Flask or FastAPI middleware for automatic trace initialization
2. **Track shared state**: Focus on tracking shared variables accessed by concurrent requests
3. **Propagate headers**: Always use `propagation_headers()` or `request()` when calling downstream services
4. **Graceful shutdown**: Call `shutdown()` before process exit:
   ```python
   import atexit
   atexit.register(raceway.shutdown)
   ```
5. **Use unique instance IDs**: Set `instance_id` to differentiate service instances

## Distributed Example

Complete Flask example with distributed tracing:

```python
from flask import Flask, request
import requests
from raceway import RacewayClient, Config
from raceway.middleware import flask_middleware

app = Flask(__name__)

raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="api-gateway",
    instance_id="gateway-1"
))

middleware = flask_middleware(raceway)

@app.before_request
def init_raceway():
    middleware.before_request()

@app.after_request
def finish_raceway(response):
    return middleware.after_request(response)

@app.route("/order", methods=["POST"])
def create_order():
    data = request.get_json()
    order_id = data["orderId"]

    raceway.track_function_call("createOrder", {"orderId": order_id})

    # Call downstream services with automatic header propagation
    inventory_result = raceway.request(
        "POST",
        "http://inventory-service:3001/reserve",
        json={"orderId": order_id}
    )

    payment_result = raceway.request(
        "POST",
        "http://payment-service:3002/charge",
        json={
            "orderId": order_id,
            "amount": inventory_result.json()["total"]
        }
    )

    return {"success": True, "orderId": order_id}

if __name__ == "__main__":
    import atexit
    atexit.register(raceway.shutdown)
    app.run(port=3000, threaded=True)
```

All services in the chain will share the same trace ID, and Raceway will merge their events into a single distributed trace.

## Event Types

Supported event types:

- **StateChange**: Variable reads and writes
- **FunctionCall**: Function entry points
- **FunctionReturn**: Function exits with return values
- **AsyncSpawn**: Spawning async tasks
- **AsyncAwait**: Awaiting async operations
- **HTTPRequest**: HTTP requests
- **HTTPResponse**: HTTP responses
- **LockAcquire**: Acquiring locks
- **LockRelease**: Releasing locks
- **Error**: Exceptions and errors

## Troubleshooting

### Events not appearing

1. Check server is running: `curl http://localhost:8080/health`
2. Enable debug mode: `Config(debug=True)`
3. Verify middleware is properly configured
4. Call `shutdown()` to flush remaining events

### Distributed traces not merging

1. Ensure all services use `propagation_headers()` when calling downstream
2. Verify `traceparent` header is being sent (enable debug mode)
3. Check that all services report to the same Raceway server
4. Verify instance IDs are unique per service instance

### Context not available errors

- Ensure middleware is set up (`@app.before_request` for Flask)
- Verify `propagation_headers()` is called within a request context
- For background tasks, context does not propagate automatically

## Performance

The SDK is designed for minimal overhead:

- Events are batched (default: 50 events per batch)
- Background thread auto-flushes every 1 second
- Non-blocking event transmission
- Automatic retry on network failures
- Thread-safe operations

## Development

### Building from Source

To build the Python SDK package:

```bash
# Install build tools
python3 -m pip install build

# Build the package
python3 -m build

# Output in dist/:
# - raceway-0.1.0.tar.gz
# - raceway-0.1.0-py3-none-any.whl
```

## Next Steps

- [TypeScript SDK](/sdks/typescript) - Node.js integration
- [Go SDK](/sdks/go) - Go integration
- [Rust SDK](/sdks/rust) - Rust integration
- [Security](/guide/security) - Best practices
- [Distributed Tracing](/guide/distributed-tracing) - Cross-service tracing
