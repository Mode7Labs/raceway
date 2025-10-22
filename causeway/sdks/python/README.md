# Raceway SDK - Python

Lightweight SDK for race condition detection in Python applications.

## Installation

```bash
pip install raceway
```

## Quick Start

```python
from raceway import RacewayClient, Config

# Initialize the client
client = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="my-service",
    environment="development",
    batch_size=50,
    flush_interval=1.0,
    debug=False,
))

# Start a trace
client.start_trace()

# Track state changes
client.track_state_change(
    variable="user.balance",      # Variable name
    old_value=100,                 # Old value
    new_value=150,                 # New value
    location="app.py:42",          # Location
    access_type="Write",           # Access type: "Read" or "Write"
)

# Track function calls
client.track_function_call(
    function_name="process_payment",  # Function name
    module="payments",                # Module
    args={"amount": 50},              # Arguments
    file="payments.py",               # File
    line=25,                          # Line number
)

# End the trace
client.end_trace()

# Shutdown (flush remaining events)
client.shutdown()
```

## Configuration

```python
@dataclass
class Config:
    """Raceway client configuration."""
    endpoint: str = "http://localhost:8080"
    service_name: str = "unknown-service"
    instance_id: Optional[str] = None  # Optional instance identifier for distributed tracing
    environment: str = "development"
    batch_size: int = 50
    flush_interval: float = 1.0  # seconds
    debug: bool = False
```

## API Reference

### `start_trace() -> str`

Starts a new trace context and returns the trace ID.

```python
trace_id = client.start_trace()
```

### `end_trace()`

Ends the current trace and queues events for sending.

```python
client.end_trace()
```

### `track_state_change(variable, old_value, new_value, location, access_type)`

Tracks a read or write to a variable.

```python
client.track_state_change(
    "counter",
    5,
    6,
    "app.py:100",
    "Write"
)
```

### `track_function_call(function_name, module, args, file, line)`

Tracks a function entry.

```python
client.track_function_call(
    "calculate_total",
    "billing",
    {"items": 3},
    "billing.py",
    50
)
```

### `track_http_request(method, url, headers=None, body=None)`

Tracks an HTTP request.

```python
client.track_http_request(
    "POST",
    "/api/users",
    {"Content-Type": "application/json"},
    {"name": "Alice"}
)
```

### `track_http_response(status, headers=None, body=None, duration_ms=0)`

Tracks an HTTP response.

```python
client.track_http_response(
    200,
    {},
    {"id": "123"},
    45
)
```

### `track_async_spawn(task_id, task_name, location)`

Tracks spawning an async task.

```python
client.track_async_spawn(
    "task-123",
    "process_payment",
    "app.py:200"
)
```

### `track_async_await(future_id, location)`

Tracks awaiting an async operation.

```python
client.track_async_await(
    "future-456",
    "app.py:210"
)
```

### `track_lock_acquire(lock_id, lock_type, location)`

Tracks acquiring a lock.

```python
client.track_lock_acquire(
    "mutex-1",
    "Lock",
    "app.py:50"
)
```

### `track_lock_release(lock_id, location)`

Tracks releasing a lock.

```python
client.track_lock_release(
    "mutex-1",
    "app.py:60"
)
```

### `track_error(error_type, message, stack_trace=None)`

Tracks an error.

```python
client.track_error(
    "ValidationError",
    "Invalid email format",
    ["app.py:100", "main.py:50"]
)
```

### `propagation_headers(extra_headers=None)`

Returns a dictionary containing `traceparent`, `tracestate` (when present), and `raceway-clock` headers for forwarding the current trace to downstream services.

```python
headers = client.propagation_headers({"x-service-name": "payments"})
requests.post("http://ledger.internal/debit", headers=headers, json={"amount": 100})
```

Call this within a request context (i.e., after the Flask/FastAPI middleware has run). It raises `RuntimeError` if invoked outside a trace.

### `request(method, url, **kwargs)`

Convenience wrapper around `requests.Session.request` that automatically adds propagation headers when a trace context is active.

```python
response = client.request("POST", "http://ledger.internal/debit", json={"amount": 100})
```

### `shutdown()`

Flushes remaining events and stops auto-flush thread.

```python
client.shutdown()
```

## Flask Integration Example

```python
from flask import Flask, request
from raceway import RacewayClient, Config
from raceway.middleware import flask_middleware

app = Flask(__name__)

# Initialize Raceway client
raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="banking-api",
    debug=False,
))

# Create middleware instance
middleware = flask_middleware(raceway)

# Use Raceway middleware
@app.before_request
def init_raceway():
    """Initialize Raceway context before each request."""
    middleware.before_request()

@app.after_request
def finish_raceway(response):
    """Finish Raceway tracking after each request."""
    return middleware.after_request(response)

@app.route("/transfer", methods=["POST"])
def transfer():
    data = request.get_json()

    raceway.track_function_call("transfer", {"from": data["from"], "to": data["to"]})

    # Read balance
    balance = accounts[data["from"]]["balance"]
    raceway.track_state_change(
        f"{data['from']}.balance",
        None,
        balance,
        "Read"
    )

    # Write new balance
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

## Event Types

The SDK supports tracking the following event types:

- **StateChange:** Variable reads and writes
- **FunctionCall:** Function entry points
- **FunctionReturn:** Function exits with return values
- **AsyncSpawn:** Spawning async tasks
- **AsyncAwait:** Awaiting async operations
- **HTTPRequest:** Outgoing HTTP requests
- **HTTPResponse:** HTTP responses
- **LockAcquire:** Acquiring locks
- **LockRelease:** Releasing locks
- **Error:** Exceptions and errors

## Best Practices

1. **Trace Per Request:** Start a new trace for each request/operation
2. **Track Shared State:** Focus on tracking accesses to shared variables
3. **Use Descriptive Locations:** Include file:line for easier debugging
4. **Batch Events:** Let the SDK batch events for performance
5. **Graceful Shutdown:** Call `shutdown()` before process exit

## Performance

The SDK is designed for minimal overhead:

- Events are batched (default: 50 events per batch)
- Auto-flush every 1 second (configurable)
- Non-blocking event transmission
- Automatic retry on network failures
- Thread-safe operations

## Learn More

- [Full Example](../../examples/python-banking/README.md)
- [Instrumentation Guide](../../docs/INSTRUMENTATION_GUIDE.md)
- [Raceway Documentation](../../README.md)
