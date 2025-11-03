"""Unit tests for trace context serialization and propagation."""

import json
import base64
import pytest
from raceway.trace_context import (
    parse_incoming_headers,
    build_propagation_headers,
    increment_clock_vector,
    ParsedTraceContext,
    PropagationHeaders,
)

VALID_TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
VALID_TRACE_ID = "0af76519-16cd-43dd-8448-eb211c80319c"
VALID_SPAN_ID = "b7ad6b7169203331"


class TestParseIncomingHeaders:
    """Tests for parse_incoming_headers function."""

    def test_parse_valid_w3c_traceparent(self):
        """Should parse valid W3C traceparent header."""
        headers = {"traceparent": VALID_TRACEPARENT}

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert result.trace_id == VALID_TRACE_ID
        assert result.span_id == VALID_SPAN_ID
        assert result.parent_span_id is None
        assert result.distributed is True

    def test_parse_valid_raceway_clock(self):
        """Should parse valid raceway-clock header."""
        clock_payload = {
            "trace_id": VALID_TRACE_ID,
            "span_id": VALID_SPAN_ID,
            "parent_span_id": "parent-span-1111",
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

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert result.trace_id == VALID_TRACE_ID
        assert result.span_id == VALID_SPAN_ID
        assert result.parent_span_id == "parent-span-1111"
        assert result.distributed is True
        assert ("upstream-service#upstream-1", 5) in result.clock_vector
        assert ("other-service#other-1", 3) in result.clock_vector

    def test_combine_traceparent_and_raceway_clock(self):
        """Should combine traceparent and raceway-clock headers."""
        clock_payload = {
            "trace_id": VALID_TRACE_ID,
            "span_id": VALID_SPAN_ID,
            "parent_span_id": "upstream-parent",
            "service": "upstream",
            "instance": "up-1",
            "clock": [["upstream#up-1", 10]],
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(clock_payload).encode("utf-8")
        ).decode("utf-8").rstrip("=")
        headers = {
            "traceparent": VALID_TRACEPARENT,
            "raceway-clock": f"v1;{encoded}",
        }

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert result.trace_id == VALID_TRACE_ID
        assert result.span_id == VALID_SPAN_ID
        assert result.parent_span_id == "upstream-parent"
        assert result.distributed is True
        assert ("upstream#up-1", 10) in result.clock_vector

    def test_generate_new_trace_when_no_headers(self):
        """Should generate new trace when no headers present."""
        headers = {}

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        # Should be a valid UUID
        assert len(result.trace_id) == 36
        assert result.trace_id.count("-") == 4
        assert result.parent_span_id is None
        assert result.distributed is False
        assert len(result.span_id) == 16

    def test_initialize_local_clock_component(self):
        """Should initialize local clock component when missing."""
        headers = {}

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert ("test-service#instance-1", 0) in result.clock_vector

    def test_preserve_existing_local_clock_component(self):
        """Should preserve existing local clock component."""
        clock_payload = {
            "trace_id": VALID_TRACE_ID,
            "span_id": VALID_SPAN_ID,
            "parent_span_id": None,
            "service": "test-service",
            "instance": "instance-1",
            "clock": [["test-service#instance-1", 42]],
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(clock_payload).encode("utf-8")
        ).decode("utf-8").rstrip("=")
        headers = {"raceway-clock": f"v1;{encoded}"}

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert ("test-service#instance-1", 42) in result.clock_vector
        # Should not duplicate
        component_count = sum(
            1 for c, _ in result.clock_vector if c == "test-service#instance-1"
        )
        assert component_count == 1

    def test_handle_malformed_traceparent(self):
        """Should handle malformed traceparent gracefully."""
        headers = {"traceparent": "invalid-format"}

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert result.distributed is False
        assert result.parent_span_id is None

    def test_handle_malformed_raceway_clock(self):
        """Should handle malformed raceway-clock gracefully."""
        headers = {"raceway-clock": "v1;invalid-base64!!!"}

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert result.distributed is False
        assert len(result.clock_vector) == 1
        assert result.clock_vector[0][0] == "test-service#instance-1"

    def test_handle_wrong_version_prefix(self):
        """Should handle wrong version prefix in raceway-clock."""
        clock_payload = {"clock": [["service#1", 1]]}
        encoded = base64.urlsafe_b64encode(
            json.dumps(clock_payload).encode("utf-8")
        ).decode("utf-8").rstrip("=")
        headers = {"raceway-clock": f"v99;{encoded}"}

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert result.distributed is False

    def test_parse_tracestate_header(self):
        """Should parse tracestate header."""
        headers = {
            "traceparent": VALID_TRACEPARENT,
            "tracestate": "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7",
        }

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert result.tracestate == "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7"

    def test_case_insensitive_headers(self):
        """Should handle case-insensitive header names."""
        headers = {"TracePARENT": VALID_TRACEPARENT}

        result = parse_incoming_headers(
            headers, service_name="test-service", instance_id="instance-1"
        )

        assert result.trace_id == VALID_TRACE_ID
        assert result.distributed is True


class TestBuildPropagationHeaders:
    """Tests for build_propagation_headers function."""

    def test_build_valid_traceparent(self):
        """Should build valid traceparent header."""
        result = build_propagation_headers(
            trace_id=VALID_TRACE_ID,
            current_span_id="current-span-id",
            tracestate=None,
            clock_vector=[],
            service_name="test-service",
            instance_id="instance-1",
        )

        assert "traceparent" in result.headers
        traceparent = result.headers["traceparent"]
        parts = traceparent.split("-")
        assert len(parts) == 4
        assert parts[0] == "00"  # version
        assert len(parts[1]) == 32  # trace-id hex
        assert len(parts[2]) == 16  # span-id hex
        assert parts[3] == "01"  # flags

    def test_build_valid_raceway_clock(self):
        """Should build valid raceway-clock header."""
        result = build_propagation_headers(
            trace_id=VALID_TRACE_ID,
            current_span_id="current-span-id",
            tracestate=None,
            clock_vector=[("test-service#instance-1", 5)],
            service_name="test-service",
            instance_id="instance-1",
        )

        assert "raceway-clock" in result.headers
        raceway_clock = result.headers["raceway-clock"]
        assert raceway_clock.startswith("v1;")

        # Decode and verify payload
        encoded = raceway_clock[3:]
        padding = "=" * ((4 - len(encoded) % 4) % 4)
        decoded = base64.urlsafe_b64decode((encoded + padding).encode("utf-8")).decode("utf-8")
        payload = json.loads(decoded)

        assert payload["trace_id"] == VALID_TRACE_ID
        assert payload["parent_span_id"] == "current-span-id"
        assert payload["service"] == "test-service"
        assert payload["instance"] == "instance-1"
        assert ["test-service#instance-1", 6] in payload["clock"]

    def test_generate_new_child_span_id(self):
        """Should generate new child span ID."""
        result = build_propagation_headers(
            trace_id=VALID_TRACE_ID,
            current_span_id="parent-span",
            tracestate=None,
            clock_vector=[],
            service_name="test-service",
            instance_id="instance-1",
        )

        assert len(result.child_span_id) == 16
        assert all(c in "0123456789abcdef" for c in result.child_span_id)
        assert result.child_span_id != "parent-span"

    def test_include_tracestate_when_present(self):
        """Should include tracestate when present."""
        result = build_propagation_headers(
            trace_id=VALID_TRACE_ID,
            current_span_id="current-span",
            tracestate="vendor=value",
            clock_vector=[],
            service_name="test-service",
            instance_id="instance-1",
        )

        assert result.headers.get("tracestate") == "vendor=value"

    def test_increment_clock_vector(self):
        """Should increment clock vector."""
        result = build_propagation_headers(
            trace_id=VALID_TRACE_ID,
            current_span_id="current-span",
            tracestate=None,
            clock_vector=[
                ("test-service#instance-1", 10),
                ("other-service#other-1", 5),
            ],
            service_name="test-service",
            instance_id="instance-1",
        )

        assert ("test-service#instance-1", 11) in result.clock_vector
        assert ("other-service#other-1", 5) in result.clock_vector


class TestIncrementClockVector:
    """Tests for increment_clock_vector function."""

    def test_increment_existing_component(self):
        """Should increment existing component."""
        vector = [("my-service#inst-1", 5)]

        result = increment_clock_vector(
            vector, service_name="my-service", instance_id="inst-1"
        )

        assert ("my-service#inst-1", 6) in result

    def test_add_new_component_when_not_present(self):
        """Should add new component when not present."""
        vector = [("other-service#other", 3)]

        result = increment_clock_vector(
            vector, service_name="my-service", instance_id="inst-1"
        )

        assert ("my-service#inst-1", 1) in result
        assert ("other-service#other", 3) in result

    def test_handle_empty_vector(self):
        """Should handle empty vector."""
        vector = []

        result = increment_clock_vector(
            vector, service_name="my-service", instance_id="inst-1"
        )

        assert result == [("my-service#inst-1", 1)]

    def test_not_mutate_original_vector(self):
        """Should not mutate original vector."""
        vector = [("my-service#inst-1", 5)]
        original = list(vector)

        increment_clock_vector(vector, service_name="my-service", instance_id="inst-1")

        assert vector == original

    def test_preserve_other_components_unchanged(self):
        """Should preserve other components unchanged."""
        vector = [
            ("service-a#1", 10),
            ("my-service#inst-1", 5),
            ("service-b#2", 7),
        ]

        result = increment_clock_vector(
            vector, service_name="my-service", instance_id="inst-1"
        )

        assert ("service-a#1", 10) in result
        assert ("my-service#inst-1", 6) in result
        assert ("service-b#2", 7) in result


class TestEndToEndScenarios:
    """End-to-end integration tests."""

    def test_full_request_flow(self):
        """Should support full request flow."""
        # Service A receives request
        incoming_headers = {"traceparent": VALID_TRACEPARENT}

        parsed = parse_incoming_headers(
            incoming_headers, service_name="service-a", instance_id="a1"
        )

        # Service A calls Service B
        outgoing_headers = build_propagation_headers(
            trace_id=parsed.trace_id,
            current_span_id=parsed.span_id,
            tracestate=parsed.tracestate,
            clock_vector=parsed.clock_vector,
            service_name="service-a",
            instance_id="a1",
        )

        # Service B receives request
        parsed_b = parse_incoming_headers(
            outgoing_headers.headers, service_name="service-b", instance_id="b1"
        )

        # Verify trace continuity
        assert parsed_b.trace_id == parsed.trace_id
        assert parsed_b.span_id == outgoing_headers.child_span_id
        assert parsed_b.parent_span_id == parsed.span_id
        assert parsed_b.distributed is True

        # Verify clock propagation
        assert ("service-a#a1", 1) in parsed_b.clock_vector
        assert ("service-b#b1", 0) in parsed_b.clock_vector

    def test_multi_hop_propagation(self):
        """Should support multi-hop propagation."""
        # Service A (initial)
        headers_ab = build_propagation_headers(
            trace_id=VALID_TRACE_ID,
            current_span_id="span-a",
            tracestate=None,
            clock_vector=[("service-a#a1", 0)],
            service_name="service-a",
            instance_id="a1",
        )

        # A → B
        parsed_b = parse_incoming_headers(
            headers_ab.headers, service_name="service-b", instance_id="b1"
        )

        # B → C
        headers_bc = build_propagation_headers(
            trace_id=parsed_b.trace_id,
            current_span_id=parsed_b.span_id,
            tracestate=parsed_b.tracestate,
            clock_vector=parsed_b.clock_vector,
            service_name="service-b",
            instance_id="b1",
        )

        parsed_c = parse_incoming_headers(
            headers_bc.headers, service_name="service-c", instance_id="c1"
        )

        # Verify full chain
        assert parsed_c.trace_id == VALID_TRACE_ID
        assert ("service-a#a1", 1) in parsed_c.clock_vector
        assert ("service-b#b1", 1) in parsed_c.clock_vector
        assert ("service-c#c1", 0) in parsed_c.clock_vector
