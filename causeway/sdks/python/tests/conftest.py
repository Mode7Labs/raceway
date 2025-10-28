"""Shared pytest fixtures for Raceway SDK tests."""

import pytest
from unittest.mock import Mock, MagicMock
from typing import List, Any
from raceway import RacewayClient, Config
from raceway.context import create_context, set_context


@pytest.fixture
def mock_session():
    """Mock requests.Session for HTTP calls."""
    session = MagicMock()
    session.post = Mock(return_value=Mock(status_code=200, json=lambda: {}))
    return session


@pytest.fixture
def captured_events():
    """List to capture events sent to client."""
    return []


@pytest.fixture
def mock_client(captured_events, mock_session, monkeypatch):
    """
    Mock RacewayClient with captured events.

    Usage:
        def test_something(mock_client, captured_events):
            mock_client.track_state_change("var", 0, 1, "Write")
            assert len(captured_events) == 1
            assert captured_events[0].kind["StateChange"]["variable"] == "var"
    """
    config = Config(
        endpoint="http://localhost:8080",
        service_name="test-service",
        batch_size=100,
        flush_interval=10.0,  # Long interval to prevent auto-flush during tests
        debug=False
    )

    client = RacewayClient(config)

    # Replace session with mock
    client.session = mock_session

    # Capture events instead of buffering
    original_capture = client._capture_event

    def capture_event_spy(ctx, kind, duration_ns=None):
        event = original_capture(ctx, kind, duration_ns)
        captured_events.append(event)
        return event

    # Monkey-patch the capture method
    monkeypatch.setattr(client, '_capture_event', capture_event_spy)

    yield client

    # Cleanup
    client.running = False


@pytest.fixture
def raceway_context():
    """Create and set a Raceway context for testing."""
    ctx = create_context(
        trace_id="test-trace-id-12345678",
        span_id="test-span-id-87654321",
        parent_span_id=None,
        distributed=False,
        clock_vector=[],
        tracestate=None
    )
    set_context(ctx)
    yield ctx
    # Explicitly clear context after test
    set_context(None)


@pytest.fixture
def flask_app():
    """Create a minimal Flask app for testing."""
    try:
        from flask import Flask
        app = Flask(__name__)
        app.config['TESTING'] = True
        return app
    except ImportError:
        pytest.skip("Flask not installed")


@pytest.fixture
def fastapi_app():
    """Create a minimal FastAPI app for testing."""
    try:
        from fastapi import FastAPI
        app = FastAPI()
        return app
    except ImportError:
        pytest.skip("FastAPI not installed")
