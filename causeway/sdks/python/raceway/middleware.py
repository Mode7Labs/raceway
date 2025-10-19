"""Middleware for automatic Raceway context management."""

import time
import uuid
from functools import wraps
from typing import Callable, Optional

from .context import create_context, set_context, get_context
from .client import RacewayClient


def flask_middleware(client: RacewayClient):
    """
    Flask middleware for automatic Raceway context initialization.

    Usage:
        from flask import Flask
        from raceway import RacewayClient, Config
        from raceway.middleware import flask_middleware

        client = RacewayClient(Config(endpoint="http://localhost:8080"))
        app = Flask(__name__)

        @app.before_request
        def init_raceway():
            flask_middleware(client).before_request()

        @app.after_request
        def finish_raceway(response):
            return flask_middleware(client).after_request(response)
    """

    class FlaskMiddleware:
        def __init__(self, client: RacewayClient):
            self.client = client

        def before_request(self):
            """Initialize Raceway context before request."""
            from flask import request

            # Extract or generate trace ID
            trace_id = request.headers.get('X-Trace-ID')
            if not trace_id or not self._is_valid_uuid(trace_id):
                trace_id = str(uuid.uuid4())

            # Create and set context
            ctx = create_context(trace_id)
            set_context(ctx)

            # Store start time for duration tracking
            request._raceway_start_time = time.time()

            # Track HTTP request
            self.client.track_http_request(request.method, request.path)

        def after_request(self, response):
            """Track HTTP response after request."""
            from flask import request

            # Calculate duration
            start_time = getattr(request, '_raceway_start_time', None)
            duration_ms = int((time.time() - start_time) * 1000) if start_time else 0

            # Track HTTP response
            self.client.track_http_response(
                status=response.status_code,
                duration_ms=duration_ms
            )

            return response

        @staticmethod
        def _is_valid_uuid(val: str) -> bool:
            """Check if string is a valid UUID."""
            try:
                uuid.UUID(val)
                return True
            except (ValueError, AttributeError):
                return False

    return FlaskMiddleware(client)


def raceway_context(trace_id: Optional[str] = None):
    """
    Decorator to run a function within a Raceway context.

    Usage:
        @raceway_context()
        def my_function():
            client.track_state_change("counter", None, 5, "Read")
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Create and set context
            ctx = create_context(trace_id or str(uuid.uuid4()))
            set_context(ctx)

            # Run function
            try:
                return func(*args, **kwargs)
            finally:
                # Context is automatically cleaned up
                pass

        return wrapper
    return decorator


# FastAPI middleware (async support)
try:
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import Response

    class FastAPIMiddleware(BaseHTTPMiddleware):
        """
        FastAPI middleware for automatic Raceway context initialization.

        Usage:
            from fastapi import FastAPI
            from raceway import RacewayClient, Config
            from raceway.middleware import FastAPIMiddleware

            client = RacewayClient(Config(endpoint="http://localhost:8080"))
            app = FastAPI()
            app.add_middleware(FastAPIMiddleware, client=client)
        """

        def __init__(self, app, client: RacewayClient):
            super().__init__(app)
            self.client = client

        async def dispatch(self, request: Request, call_next):
            # Extract or generate trace ID
            trace_id = request.headers.get('x-trace-id')
            if not trace_id or not self._is_valid_uuid(trace_id):
                trace_id = str(uuid.uuid4())

            # Create and set context (contextvars work with async!)
            ctx = create_context(trace_id)
            set_context(ctx)

            # Track HTTP request
            start_time = time.time()
            self.client.track_http_request(request.method, str(request.url))

            # Process request
            response = await call_next(request)

            # Track HTTP response
            duration_ms = int((time.time() - start_time) * 1000)
            self.client.track_http_response(
                status=response.status_code,
                duration_ms=duration_ms
            )

            return response

        @staticmethod
        def _is_valid_uuid(val: str) -> bool:
            """Check if string is a valid UUID."""
            try:
                uuid.UUID(val)
                return True
            except (ValueError, AttributeError):
                return False

except ImportError:
    # FastAPI not installed, skip FastAPI middleware
    class FastAPIMiddleware:
        """FastAPI middleware (requires starlette/fastapi to be installed)."""
        def __init__(self, *args, **kwargs):
            raise ImportError(
                "FastAPI middleware requires starlette and fastapi packages. "
                "Install with: pip install fastapi"
            )
