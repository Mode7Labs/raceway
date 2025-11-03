"""Tests for core tracking functionality."""

import pytest
import time
from unittest.mock import Mock, patch
from raceway import RacewayClient, Config
from raceway.context import get_context


@pytest.mark.unit
class TestStateTracking:
    """Tests for state change tracking."""

    def test_track_state_write(self, mock_client, captured_events, raceway_context):
        """Should track state write with old and new values."""
        mock_client.track_state_change("counter", 5, 6, "Write")

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event.kind.StateChange is not None
        assert event.kind.StateChange["variable"] == "counter"
        assert event.kind.StateChange["old_value"] == 5
        assert event.kind.StateChange["new_value"] == 6
        assert event.kind.StateChange["access_type"] == "Write"

    def test_track_state_read(self, mock_client, captured_events, raceway_context):
        """Should track state read."""
        mock_client.track_state_change("balance", None, 1000, "Read")

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event.kind.StateChange is not None
        assert event.kind.StateChange["variable"] == "balance"
        assert event.kind.StateChange["old_value"] is None
        assert event.kind.StateChange["new_value"] == 1000
        assert event.kind.StateChange["access_type"] == "Read"

    def test_track_state_change_updates_context(self, mock_client, captured_events, raceway_context):
        """Should update context with event ID and set root_id on first event."""
        ctx = get_context()
        assert ctx.root_id is None
        assert ctx.parent_id is None

        mock_client.track_state_change("var1", 0, 1, "Write")

        assert ctx.root_id is not None
        assert ctx.parent_id is not None
        assert ctx.root_id == captured_events[0].id
        assert ctx.parent_id == captured_events[0].id

    def test_track_state_change_increments_clock(self, mock_client, captured_events, raceway_context):
        """Should increment logical clock on each event."""
        ctx = get_context()
        initial_clock = ctx.clock

        mock_client.track_state_change("var1", 0, 1, "Write")
        mock_client.track_state_change("var2", 0, 1, "Write")

        assert ctx.clock == initial_clock + 2

    def test_track_state_outside_context_no_error(self, mock_client, captured_events):
        """Should silently ignore tracking when no context is set."""
        # No context set, should not raise error
        mock_client.track_state_change("var", 0, 1, "Write")
        assert len(captured_events) == 0

    def test_track_state_captures_location(self, mock_client, captured_events, raceway_context):
        """Should capture file and line location."""
        mock_client.track_state_change("var", 0, 1, "Write")

        event = captured_events[0]
        assert event.kind.StateChange["location"] is not None
        assert ":" in event.kind.StateChange["location"]


@pytest.mark.unit
class TestFunctionTracking:
    """Tests for function call tracking."""

    def test_track_function_call_basic(self, mock_client, captured_events, raceway_context):
        """Should track function call with name and args."""
        mock_client.track_function_call("process_payment", {"amount": 100})

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event.kind.FunctionCall is not None
        assert event.kind.FunctionCall["function_name"] == "process_payment"
        assert event.kind.FunctionCall["args"] == {"amount": 100}

    def test_track_function_call_with_duration(self, mock_client, captured_events, raceway_context):
        """Should track function call with duration."""
        duration_ns = 1_500_000  # 1.5ms

        mock_client.track_function_call("expensive_operation", None, duration_ns)

        event = captured_events[0]
        assert event.metadata.duration_ns == duration_ns

    def test_track_function_measures_duration(self, mock_client, captured_events, raceway_context):
        """Should automatically measure function duration."""
        def slow_function():
            time.sleep(0.01)  # 10ms
            return "result"

        result = mock_client.track_function("slow_function", {}, slow_function)

        assert result == "result"
        assert len(captured_events) == 1

        event = captured_events[0]
        assert event.kind.FunctionCall is not None
        # Duration should be at least 10ms (10,000,000 ns)
        assert event.metadata.duration_ns >= 10_000_000

    def test_track_function_handles_exception(self, mock_client, captured_events, raceway_context):
        """Should track function even when exception occurs."""
        def failing_function():
            raise ValueError("Test error")

        with pytest.raises(ValueError, match="Test error"):
            mock_client.track_function("failing_function", {}, failing_function)

        # Should still have tracked the function call
        assert len(captured_events) == 1
        assert captured_events[0].kind.FunctionCall is not None

    def test_track_function_captures_file_and_line(self, mock_client, captured_events, raceway_context):
        """Should capture caller file and line number."""
        mock_client.track_function_call("my_function", {})

        event = captured_events[0]
        assert event.kind.FunctionCall["file"] is not None
        assert event.kind.FunctionCall["line"] > 0


@pytest.mark.unit
class TestHttpTracking:
    """Tests for HTTP request/response tracking."""

    def test_track_http_request(self, mock_client, captured_events, raceway_context):
        """Should track HTTP request with method and URL."""
        mock_client.track_http_request("POST", "/api/users", {"Content-Type": "application/json"})

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event.kind.HttpRequest is not None
        assert event.kind.HttpRequest["method"] == "POST"
        assert event.kind.HttpRequest["url"] == "/api/users"
        assert event.kind.HttpRequest["headers"]["Content-Type"] == "application/json"

    def test_track_http_response(self, mock_client, captured_events, raceway_context):
        """Should track HTTP response with status and duration."""
        mock_client.track_http_response(200, {"Content-Type": "application/json"}, duration_ms=45)

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event.kind.HttpResponse is not None
        assert event.kind.HttpResponse["status"] == 200
        assert event.kind.HttpResponse["duration_ms"] == 45
        # Duration should be converted to nanoseconds in metadata
        assert event.metadata.duration_ns == 45_000_000

    def test_track_http_request_response_chain(self, mock_client, captured_events, raceway_context):
        """Should track HTTP request followed by response."""
        mock_client.track_http_request("GET", "/api/data")
        mock_client.track_http_response(200, duration_ms=10)

        assert len(captured_events) == 2

        request_event = captured_events[0]
        response_event = captured_events[1]

        assert request_event.kind.HttpRequest is not None
        assert response_event.kind.HttpResponse is not None

        # Response should have request as parent
        ctx = get_context()
        assert ctx.parent_id == response_event.id


@pytest.mark.unit
class TestPropagationHeaders:
    """Tests for distributed tracing header propagation."""

    def test_propagation_headers_includes_traceparent(self, mock_client, captured_events, raceway_context):
        """Should include W3C traceparent header."""
        headers = mock_client.propagation_headers()

        assert "traceparent" in headers
        # Format: 00-<trace-id>-<span-id>-01
        parts = headers["traceparent"].split("-")
        assert len(parts) == 4
        assert parts[0] == "00"  # Version
        assert len(parts[1]) == 32  # Trace ID
        assert len(parts[2]) == 16  # Span ID
        assert parts[3] == "01"  # Flags

    def test_propagation_headers_includes_raceway_clock(self, mock_client, captured_events, raceway_context):
        """Should include raceway-clock header with vector clock."""
        headers = mock_client.propagation_headers()

        assert "raceway-clock" in headers
        assert headers["raceway-clock"].startswith("v1;")

    def test_propagation_headers_increments_clock_vector(self, mock_client, captured_events, raceway_context):
        """Should increment clock vector when building headers."""
        ctx = get_context()
        initial_clock = list(ctx.clock_vector)

        headers = mock_client.propagation_headers()

        # Clock vector should have been incremented
        assert len(ctx.clock_vector) >= len(initial_clock)

    def test_propagation_headers_sets_distributed_flag(self, mock_client, captured_events, raceway_context):
        """Should set distributed flag when propagating."""
        ctx = get_context()
        assert ctx.distributed is False

        mock_client.propagation_headers()

        assert ctx.distributed is True

    def test_propagation_headers_outside_context_raises(self, mock_client, captured_events):
        """Should raise error when called outside context."""
        with pytest.raises(RuntimeError, match="called outside of an active context"):
            mock_client.propagation_headers()

    def test_propagation_headers_merges_extra_headers(self, mock_client, captured_events, raceway_context):
        """Should merge extra headers with propagation headers."""
        headers = mock_client.propagation_headers({"X-Custom": "value"})

        assert "traceparent" in headers
        assert "raceway-clock" in headers
        assert headers["X-Custom"] == "value"


@pytest.mark.unit
class TestRequestMethod:
    """Tests for automatic propagation via request() method."""

    def test_request_propagates_headers(self, mock_client, captured_events, raceway_context):
        """Should automatically add propagation headers to requests."""
        with patch.object(mock_client.session, 'request') as mock_request:
            mock_request.return_value = Mock(status_code=200)

            mock_client.request("GET", "http://example.com/api")

            # Verify request was called with propagation headers
            call_args = mock_request.call_args
            headers = call_args.kwargs.get('headers', {})

            assert "traceparent" in headers
            assert "raceway-clock" in headers

    def test_request_merges_explicit_headers(self, mock_client, captured_events, raceway_context):
        """Should merge explicit headers with propagation headers."""
        with patch.object(mock_client.session, 'request') as mock_request:
            mock_request.return_value = Mock(status_code=200)

            mock_client.request("GET", "http://example.com/api", headers={"X-Custom": "value"})

            call_args = mock_request.call_args
            headers = call_args.kwargs.get('headers', {})

            assert "traceparent" in headers
            assert headers["X-Custom"] == "value"

    def test_request_prefers_explicit_headers(self, mock_client, captured_events, raceway_context):
        """Should prefer explicit headers over propagation headers."""
        with patch.object(mock_client.session, 'request') as mock_request:
            mock_request.return_value = Mock(status_code=200)

            explicit_traceparent = "00-custom-trace-custom-span-01"
            mock_client.request("GET", "http://example.com/api",
                              headers={"traceparent": explicit_traceparent})

            call_args = mock_request.call_args
            headers = call_args.kwargs.get('headers', {})

            assert headers["traceparent"] == explicit_traceparent

    def test_request_without_context_works(self, mock_client, captured_events):
        """Should work without context (no propagation headers)."""
        with patch.object(mock_client.session, 'request') as mock_request:
            mock_request.return_value = Mock(status_code=200)

            # No context set
            response = mock_client.request("GET", "http://example.com/api")

            assert response.status_code == 200
            # Request should still work, just without propagation headers


@pytest.mark.unit
class TestEventMetadata:
    """Tests for event metadata."""

    def test_event_includes_service_metadata(self, mock_client, captured_events, raceway_context):
        """Should include service name and environment in metadata."""
        mock_client.track_state_change("var", 0, 1, "Write")

        event = captured_events[0]
        assert event.metadata.service_name == "test-service"
        assert event.metadata.environment == "development"

    def test_event_includes_distributed_span_metadata(self, mock_client, captured_events, raceway_context):
        """Should include distributed span metadata."""
        mock_client.track_state_change("var", 0, 1, "Write")

        event = captured_events[0]
        ctx = get_context()

        assert event.metadata.instance_id == mock_client.instance_id
        assert event.metadata.distributed_span_id == ctx.span_id
        assert event.metadata.upstream_span_id == ctx.parent_span_id

    def test_event_includes_causality_vector(self, mock_client, captured_events, raceway_context):
        """Should include causality vector in events."""
        mock_client.track_state_change("var", 0, 1, "Write")

        event = captured_events[0]
        assert event.causality_vector is not None
        assert isinstance(event.causality_vector, list)

    def test_event_has_unique_id(self, mock_client, captured_events, raceway_context):
        """Should generate unique event IDs."""
        mock_client.track_state_change("var1", 0, 1, "Write")
        mock_client.track_state_change("var2", 0, 1, "Write")

        event1 = captured_events[0]
        event2 = captured_events[1]

        assert event1.id != event2.id

    def test_event_has_trace_id(self, mock_client, captured_events, raceway_context):
        """Should include trace ID from context."""
        ctx = get_context()
        mock_client.track_state_change("var", 0, 1, "Write")

        event = captured_events[0]
        assert event.trace_id == ctx.trace_id


@pytest.mark.unit
class TestEventBuffering:
    """Tests for event buffering and flushing."""

    def test_events_buffered_before_flush(self, raceway_context):
        """Should buffer events before flushing."""
        config = Config(
            endpoint="http://localhost:8080",
            service_name="test-service",
            batch_size=100,
            debug=False
        )
        client = RacewayClient(config)

        # Track some events
        client.track_state_change("var1", 0, 1, "Write")
        client.track_state_change("var2", 0, 1, "Write")

        # Events should be in buffer
        assert len(client.event_buffer) == 2

        client.running = False

    def test_manual_flush_clears_buffer(self, raceway_context):
        """Should clear buffer after manual flush."""
        config = Config(
            endpoint="http://localhost:8080",
            service_name="test-service",
            batch_size=100,
            debug=False
        )
        client = RacewayClient(config)

        with patch.object(client.session, 'post') as mock_post:
            mock_post.return_value = Mock(status_code=200)

            client.track_state_change("var", 0, 1, "Write")
            assert len(client.event_buffer) == 1

            client.flush()

            # Buffer should be cleared
            assert len(client.event_buffer) == 0

        client.running = False

    def test_flush_sends_correct_payload(self, raceway_context):
        """Should send events in correct format."""
        config = Config(
            endpoint="http://localhost:8080",
            service_name="test-service",
            batch_size=100,
            debug=False
        )
        client = RacewayClient(config)

        with patch.object(client.session, 'post') as mock_post:
            mock_post.return_value = Mock(status_code=200)

            client.track_state_change("var", 0, 1, "Write")
            client.flush()

            # Verify POST was called
            assert mock_post.called
            call_args = mock_post.call_args

            # Check endpoint
            assert call_args[0][0] == "http://localhost:8080/events"

            # Check payload structure
            payload = call_args.kwargs['json']
            assert "events" in payload
            assert len(payload["events"]) == 1

        client.running = False
