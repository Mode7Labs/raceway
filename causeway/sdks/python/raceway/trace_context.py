"""Trace context utilities for distributed propagation."""

from __future__ import annotations

import base64
import binascii
import json
import secrets
import uuid
from dataclasses import dataclass
from typing import Mapping, Optional, Tuple, List, Dict

TRACEPARENT_HEADER = "traceparent"
TRACESTATE_HEADER = "tracestate"
RACEWAY_CLOCK_HEADER = "raceway-clock"

TRACEPARENT_VERSION = "00"
TRACE_FLAGS = "01"
CLOCK_VERSION_PREFIX = "v1;"


@dataclass
class ParsedTraceContext:
    trace_id: str
    span_id: str
    parent_span_id: Optional[str]
    tracestate: Optional[str]
    clock_vector: List[Tuple[str, int]]
    distributed: bool


@dataclass
class PropagationHeaders:
    headers: Dict[str, str]
    clock_vector: List[Tuple[str, int]]
    child_span_id: str


def parse_incoming_headers(
    headers: Mapping[str, str],
    *,
    service_name: str,
    instance_id: str,
) -> ParsedTraceContext:
    """Parse inbound HTTP headers into a trace context structure."""
    lower_headers = {k.lower(): v for k, v in headers.items()}

    traceparent_raw = lower_headers.get(TRACEPARENT_HEADER)
    tracestate_raw = lower_headers.get(TRACESTATE_HEADER)
    raceway_clock_raw = lower_headers.get(RACEWAY_CLOCK_HEADER)

    trace_id = str(uuid.uuid4())
    parent_span_id: Optional[str] = None
    distributed = False

    if traceparent_raw:
        parsed = _parse_traceparent(traceparent_raw)
        if parsed:
            trace_id = parsed["trace_id"]
            parent_span_id = parsed["span_id"]
            distributed = True

    clock_vector: List[Tuple[str, int]] = []
    if raceway_clock_raw:
        parsed_clock = _parse_raceway_clock(raceway_clock_raw)
        if parsed_clock:
            clock_vector = parsed_clock["clock"]
            distributed = True
            if parsed_clock["trace_id"]:
                trace_id = parsed_clock["trace_id"]
            if not parent_span_id and parsed_clock["parent_span_id"]:
                parent_span_id = parsed_clock["parent_span_id"]

    component_id = _clock_component(service_name, instance_id)
    if not any(component == component_id for component, _ in clock_vector):
        clock_vector.append((component_id, 0))

    return ParsedTraceContext(
        trace_id=trace_id,
        span_id=_generate_span_id(),
        parent_span_id=parent_span_id,
        tracestate=tracestate_raw,
        clock_vector=clock_vector,
        distributed=distributed,
    )


def build_propagation_headers(
    *,
    trace_id: str,
    current_span_id: str,
    tracestate: Optional[str],
    clock_vector: List[Tuple[str, int]],
    service_name: str,
    instance_id: str,
) -> PropagationHeaders:
    """Build outbound propagation headers and updated clock vector."""
    next_clock_vector = increment_clock_vector(clock_vector, service_name=service_name, instance_id=instance_id)

    child_span_id = _generate_span_id()
    traceparent = "{}-{}-{}-{}".format(
        TRACEPARENT_VERSION,
        _uuid_to_traceparent(trace_id),
        child_span_id,
        TRACE_FLAGS,
    )

    payload = {
        "trace_id": trace_id,
        "span_id": child_span_id,
        "parent_span_id": current_span_id,
        "service": service_name,
        "instance": instance_id,
        "clock": next_clock_vector,
    }

    raceway_clock = CLOCK_VERSION_PREFIX + _encode_base64url(json.dumps(payload, separators=(",", ":")))

    headers: Dict[str, str] = {
        TRACEPARENT_HEADER: traceparent,
        RACEWAY_CLOCK_HEADER: raceway_clock,
    }
    if tracestate:
        headers[TRACESTATE_HEADER] = tracestate

    return PropagationHeaders(headers=headers, clock_vector=next_clock_vector, child_span_id=child_span_id)


def increment_clock_vector(
    clock_vector: List[Tuple[str, int]],
    *,
    service_name: str,
    instance_id: str,
) -> List[Tuple[str, int]]:
    """Increment the clock component for this service/instance."""
    component = _clock_component(service_name, instance_id)
    updated: List[Tuple[str, int]] = []
    found = False
    for entry_component, value in clock_vector:
        if entry_component == component:
            updated.append((entry_component, value + 1))
            found = True
        else:
            updated.append((entry_component, value))

    if not found:
        updated.append((component, 1))

    return updated


def _parse_traceparent(value: str) -> Optional[Dict[str, str]]:
    parts = value.strip().split("-")
    if len(parts) != 4:
        return None

    _, trace_id_hex, span_id_hex, _ = parts
    if not _is_hex(trace_id_hex, 32) or not _is_hex(span_id_hex, 16):
        return None

    return {
        "trace_id": _traceparent_to_uuid(trace_id_hex),
        "span_id": span_id_hex.lower(),
    }


def _parse_raceway_clock(value: str) -> Optional[Dict[str, Optional[str]]]:
    if not value.startswith(CLOCK_VERSION_PREFIX):
        return None

    encoded = value[len(CLOCK_VERSION_PREFIX) :]
    try:
        payload = json.loads(_decode_base64url(encoded))
    except (json.JSONDecodeError, ValueError, binascii.Error):  # type: ignore[name-defined]
        return None

    clock_entries = []
    for item in payload.get("clock", []):
        if (
            isinstance(item, list)
            and len(item) == 2
            and isinstance(item[0], str)
            and isinstance(item[1], (int, float))
        ):
            clock_entries.append((item[0], int(item[1])))

    return {
        "trace_id": payload.get("trace_id"),
        "parent_span_id": payload.get("span_id"),  # span_id from sender becomes parent for receiver
        "clock": clock_entries,
    }


def _clock_component(service_name: str, instance_id: str) -> str:
    return f"{service_name}#{instance_id}"


def _generate_span_id() -> str:
    return secrets.token_hex(8)


def _uuid_to_traceparent(value: str) -> str:
    return value.replace("-", "").ljust(32, "0")[:32]


def _traceparent_to_uuid(value: str) -> str:
    return "{}-{}-{}-{}-{}".format(
        value[0:8],
        value[8:12],
        value[12:16],
        value[16:20],
        value[20:32],
    )


def _is_hex(value: str, expected_length: int) -> bool:
    if len(value) != expected_length:
        return False
    try:
        int(value, 16)
        return True
    except ValueError:
        return False


def _encode_base64url(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("utf-8").rstrip("=")


def _decode_base64url(value: str) -> str:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("utf-8")).decode("utf-8")
