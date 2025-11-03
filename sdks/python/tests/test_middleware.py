"""Tests for Flask and FastAPI middleware."""

import pytest
from unittest.mock import Mock, patch
from raceway import RacewayClient, Config
from raceway.middleware import flask_middleware
from raceway.context import get_context


@pytest.mark.middleware
class TestFlaskMiddleware:
    """Tests for Flask middleware integration."""

    def test_middleware_initializes_context(self, mock_client, captured_events, flask_app):
        """Should create context for incoming Flask request."""
        middleware = flask_middleware(mock_client)

        with flask_app.test_request_context('/', method='GET'):
            from flask import request

            middleware.before_request()

            # Context should be set
            ctx = get_context()
            assert ctx is not None
            assert ctx.trace_id is not None
            assert ctx.span_id is not None
            assert hasattr(request, 'racewayContext')

    def test_middleware_parses_w3c_traceparent(self, mock_client, captured_events, flask_app):
        """Should parse W3C traceparent header."""
        middleware = flask_middleware(mock_client)
        traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"

        with flask_app.test_request_context('/', method='GET', headers={'traceparent': traceparent}):
            middleware.before_request()

            ctx = get_context()
            assert ctx is not None
            assert "0af76519" in ctx.trace_id  # Trace ID from header
            assert ctx.distributed is True

    def test_middleware_parses_raceway_clock(self, mock_client, captured_events, flask_app):
        """Should parse raceway-clock header with vector clock."""
        import json
        import base64

        middleware = flask_middleware(mock_client)

        clock_payload = {
            "trace_id": "test-trace-123",
            "span_id": "span-456",
            "parent_span_id": "parent-789",
            "service": "upstream-service",
            "instance": "upstream-1",
            "clock": [
                ["upstream-service#upstream-1", 5],
                ["other-service#other-1", 3],
            ],
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(clock_payload).encode("utf-8")
        ).decode("utf-8").rstrip("=")

        headers = {"raceway-clock": f"v1;{encoded}"}

        with flask_app.test_request_context('/', method='GET', headers=headers):
            middleware.before_request()

            ctx = get_context()
            assert ctx is not None
            assert ctx.trace_id == "test-trace-123"
            assert ctx.distributed is True
            assert len(ctx.clock_vector) >= 2

    def test_middleware_generates_new_trace_when_no_headers(self, mock_client, captured_events, flask_app):
        """Should generate new trace when no headers present."""
        middleware = flask_middleware(mock_client)

        with flask_app.test_request_context('/', method='GET'):
            middleware.before_request()

            ctx = get_context()
            assert ctx is not None
            assert ctx.trace_id is not None
            assert len(ctx.trace_id) > 0
            assert ctx.distributed is False
            assert ctx.parent_span_id is None

    def test_middleware_tracks_http_request_automatically(self, mock_client, captured_events, flask_app):
        """Should automatically track HTTP request event."""
        middleware = flask_middleware(mock_client)

        with flask_app.test_request_context('/api/test', method='POST'):
            middleware.before_request()

            # Should have tracked HTTP request
            assert len(captured_events) > 0
            http_request_event = next(
                (e for e in captured_events if e.kind.HttpRequest is not None), None
            )
            assert http_request_event is not None
            assert http_request_event.kind.HttpRequest["method"] == "POST"
            assert http_request_event.kind.HttpRequest["url"] == "/api/test"

    def test_middleware_tracks_http_response(self, mock_client, captured_events, flask_app):
        """Should track HTTP response with duration."""
        middleware = flask_middleware(mock_client)

        with flask_app.test_request_context('/', method='GET'):
            from flask import make_response

            middleware.before_request()
            captured_events.clear()  # Clear the HTTP request event

            response = make_response("OK", 200)
            middleware.after_request(response)

            # Should have tracked HTTP response
            http_response_event = next(
                (e for e in captured_events if e.kind.HttpResponse is not None), None
            )
            assert http_response_event is not None
            assert http_response_event.kind.HttpResponse["status"] == 200
            assert http_response_event.kind.HttpResponse["duration_ms"] >= 0

    def test_middleware_generates_unique_contexts_per_request(self, mock_client, captured_events, flask_app):
        """Should generate unique contexts for concurrent requests."""
        middleware = flask_middleware(mock_client)

        trace_ids = []

        # Simulate two requests
        with flask_app.test_request_context('/req1', method='GET'):
            middleware.before_request()
            ctx1 = get_context()
            trace_ids.append(ctx1.trace_id)

        with flask_app.test_request_context('/req2', method='GET'):
            middleware.before_request()
            ctx2 = get_context()
            trace_ids.append(ctx2.trace_id)

        # Should have different trace IDs
        assert len(set(trace_ids)) == 2

    def test_middleware_handles_malformed_traceparent_gracefully(self, mock_client, captured_events, flask_app):
        """Should handle malformed traceparent header gracefully."""
        middleware = flask_middleware(mock_client)

        with flask_app.test_request_context('/', method='GET', headers={'traceparent': 'invalid-format'}):
            middleware.before_request()

            # Should fall back to generating new trace
            ctx = get_context()
            assert ctx is not None
            assert ctx.trace_id is not None

    def test_middleware_sets_request_attribute(self, mock_client, captured_events, flask_app):
        """Should set racewayContext on request object."""
        middleware = flask_middleware(mock_client)

        with flask_app.test_request_context('/', method='GET'):
            from flask import request

            middleware.before_request()

            assert hasattr(request, 'racewayContext')
            assert request.racewayContext.trace_id is not None

    def test_middleware_calculates_duration(self, mock_client, captured_events, flask_app):
        """Should calculate request duration."""
        import time
        middleware = flask_middleware(mock_client)

        with flask_app.test_request_context('/', method='GET'):
            from flask import make_response, request

            middleware.before_request()
            time.sleep(0.01)  # Sleep 10ms
            captured_events.clear()

            response = make_response("OK", 200)
            middleware.after_request(response)

            http_response_event = next(
                (e for e in captured_events if e.kind.HttpResponse is not None), None
            )
            assert http_response_event is not None
            # Duration should be at least 10ms
            assert http_response_event.kind.HttpResponse["duration_ms"] >= 10


@pytest.mark.middleware
@pytest.mark.integration
class TestFastAPIMiddleware:
    """Tests for FastAPI middleware integration."""

    @pytest.mark.asyncio
    async def test_fastapi_middleware_basic(self, mock_client, captured_events):
        """Should handle basic FastAPI request."""
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
            from raceway.middleware import fastapi_middleware

            app = FastAPI()
            app.middleware("http")(fastapi_middleware(mock_client))

            @app.get("/")
            async def root():
                return {"message": "Hello"}

            client = TestClient(app)
            response = client.get("/")

            assert response.status_code == 200
            # Should have tracked HTTP request and response
            assert len(captured_events) >= 2

        except ImportError:
            pytest.skip("FastAPI not installed")

    @pytest.mark.asyncio
    async def test_fastapi_context_available_in_handler(self, mock_client, captured_events):
        """Should make context available in async handler."""
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
            from raceway.middleware import fastapi_middleware
            from raceway.context import get_context

            app = FastAPI()
            app.middleware("http")(fastapi_middleware(mock_client))

            context_was_set = False

            @app.get("/")
            async def root():
                nonlocal context_was_set
                ctx = get_context()
                context_was_set = (ctx is not None)
                return {"message": "Hello"}

            client = TestClient(app)
            response = client.get("/")

            assert response.status_code == 200
            assert context_was_set

        except ImportError:
            pytest.skip("FastAPI not installed")


@pytest.mark.middleware
class TestContextDecorator:
    """Tests for raceway_context decorator."""

    def test_context_decorator_creates_context(self, mock_client, captured_events):
        """Should create context for decorated function."""
        from raceway.middleware import raceway_context

        @raceway_context()
        def my_function():
            ctx = get_context()
            assert ctx is not None
            return ctx.trace_id

        trace_id = my_function()
        assert trace_id is not None

    def test_context_decorator_with_custom_trace_id(self, mock_client, captured_events):
        """Should use custom trace ID when provided."""
        from raceway.middleware import raceway_context

        custom_trace_id = "custom-trace-123"

        @raceway_context(trace_id=custom_trace_id)
        def my_function():
            ctx = get_context()
            return ctx.trace_id

        trace_id = my_function()
        assert trace_id == custom_trace_id
