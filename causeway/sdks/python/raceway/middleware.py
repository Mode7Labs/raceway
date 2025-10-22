"""Middleware for automatic Raceway context management."""

import time
from functools import wraps
from typing import Callable, Optional

from .context import create_context, set_context
from .client import RacewayClient
from .trace_context import parse_incoming_headers


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

            if self.client.config.debug:
                print(f"[Raceway] Middleware before_request called for {request.method} {request.path}", flush=True)

            parsed = parse_incoming_headers(
                request.headers,
                service_name=self.client.config.service_name,
                instance_id=self.client.instance_id,
            )

            if self.client.config.debug:
                print(f"[Raceway] Parsed headers: trace_id={parsed.trace_id[:8]}, "
                      f"distributed={parsed.distributed}, span_id={parsed.span_id[:8]}, "
                      f"parent_span_id={parsed.parent_span_id[:8] if parsed.parent_span_id else None}")

            # Create and set context
            ctx = create_context(
                trace_id=parsed.trace_id,
                span_id=parsed.span_id,
                parent_span_id=parsed.parent_span_id,
                distributed=parsed.distributed,
                clock_vector=parsed.clock_vector,
                tracestate=parsed.tracestate,
            )
            set_context(ctx)
            request.raceway_context = ctx

            if self.client.config.debug:
                print(f"[Raceway] Context set: trace_id={ctx.trace_id[:8]}, distributed={ctx.distributed}", flush=True)

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
            parsed = parse_incoming_headers(
                request.headers,
                service_name=self.client.config.service_name,
                instance_id=self.client.instance_id,
            )

            # Create and set context (contextvars work with async!)
            ctx = create_context(
                trace_id=parsed.trace_id,
                span_id=parsed.span_id,
                parent_span_id=parsed.parent_span_id,
                distributed=parsed.distributed,
                clock_vector=parsed.clock_vector,
                tracestate=parsed.tracestate,
            )
            set_context(ctx)
            request.state.raceway_context = ctx

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

except ImportError:
    # FastAPI not installed, skip FastAPI middleware
    class FastAPIMiddleware:
        """FastAPI middleware (requires starlette/fastapi to be installed)."""
        def __init__(self, *args, **kwargs):
            raise ImportError(
                "FastAPI middleware requires starlette and fastapi packages. "
                "Install with: pip install fastapi"
            )
