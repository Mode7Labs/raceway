# Raceway SDK - Python

Official Python SDK for [Raceway](https://github.com/mode7labs/raceway) - Race condition detection and distributed tracing for Python applications.

📚 **[Full Documentation](https://mode7labs.github.io/raceway/sdks/python)**

## Features

- Automatic context propagation using contextvars
- Flask and FastAPI middleware support
- Distributed tracing across service boundaries (W3C Trace Context)
- Race condition and concurrency bug detection
- Automatic batching and background flushing

## Installation

```bash
pip install raceway
```

## Quick Start

### Flask

```python
from flask import Flask, request
from raceway import RacewayClient, Config
from raceway.middleware import flask_middleware

app = Flask(__name__)

raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="my-service"
))

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
        None, balance, "Read"
    )

    accounts[data["from"]]["balance"] -= data["amount"]
    raceway.track_state_change(
        f"{data['from']}.balance",
        balance, accounts[data["from"]]["balance"], "Write"
    )

    return {"success": True}

if __name__ == "__main__":
    import atexit
    atexit.register(raceway.shutdown)
    app.run(port=3000, threaded=True)
```

## Distributed Tracing

Propagate traces across service boundaries:

```python
import requests

@app.route("/checkout", methods=["POST"])
def checkout():
    order_id = request.get_json()["orderId"]

    # Get propagation headers
    headers = raceway.propagation_headers()

    # Call downstream services with automatic header propagation
    response = raceway.request(
        "POST",
        "http://inventory-service/reserve",
        json={"orderId": order_id}
    )

    return {"success": True}
```

## Documentation

- 📚 **[Full SDK Documentation](https://mode7labs.github.io/raceway/sdks/python)** - Complete API reference and examples
- 🚀 **[Getting Started Guide](https://mode7labs.github.io/raceway/guide/getting-started)** - Step-by-step setup
- 🔍 **[Race Detection Guide](https://mode7labs.github.io/raceway/guide/race-detection)** - Understanding race conditions
- 🌐 **[Distributed Tracing](https://mode7labs.github.io/raceway/guide/distributed-tracing)** - Cross-service tracing
- 🔐 **[Security Guide](https://mode7labs.github.io/raceway/guide/security)** - Best practices

## Examples

See [examples/python-banking](../../examples/python-banking) for a complete Flask application with Raceway integration.

## License

MIT

## Links

- [GitHub Repository](https://github.com/mode7labs/raceway)
- [Documentation](https://mode7labs.github.io/raceway)
- [Issue Tracker](https://github.com/mode7labs/raceway/issues)
