"""Raceway client implementation."""

import os
import socket
import threading
import time
import uuid
import traceback
import inspect
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Optional, Any, List, Dict, Tuple
import requests

from .context import get_context, update_context
from .trace_context import build_propagation_headers, increment_clock_vector
from .types import Config, Event, EventKind, EventMetadata


class RacewayClient:
    """Main Raceway SDK client."""

    def __init__(self, config: Optional[Config] = None):
        """Initialize the client."""
        self.config = config or Config()
        self.instance_id = (
            self.config.instance_id
            or os.getenv("RACEWAY_INSTANCE_ID")
            or f"{self._safe_hostname()}-{os.getpid()}"
        )
        self.event_buffer: List[Event] = []
        self.lock = threading.RLock()
        self.session = requests.Session()

        # Use provided API key from config
        if self.config.api_key:
            token = self.config.api_key.strip()
            self.session.headers.update({
                "Authorization": f"Bearer {token}",
                "X-Raceway-Key": token,
            })
        self.running = True

        # Start auto-flush thread
        self.flush_thread = threading.Thread(target=self._auto_flush, daemon=True)
        self.flush_thread.start()

        # Debug logging on initialization
        if self.config.debug:
            print(f"[Raceway] Initialized with config: endpoint={self.config.endpoint}, "
                  f"service={self.config.service_name}, instance={self.instance_id}, "
                  f"batch_size={self.config.batch_size}, flush_interval={self.config.flush_interval}")

    def track_state_change(
        self,
        variable: str,
        old_value: Any,
        new_value: Any,
        access_type: str = "Write"
    ):
        """
        Track a state change (read or write).

        Args:
            variable: Variable name
            old_value: Previous value (None for reads)
            new_value: New value
            access_type: "Read" or "Write"
        """
        ctx = get_context()
        if ctx is None:
            if self.config.debug:
                print("[Raceway] track_state_change called outside of context", flush=True)
            return

        location = self._capture_location()
        is_first_event = ctx.root_id is None

        event = self._capture_event(
            ctx,
            EventKind(
                StateChange={
                    "variable": variable,
                    "old_value": old_value,
                    "new_value": new_value,
                    "location": location,
                    "access_type": access_type,
                }
            )
        )

        update_context(event.id, is_first_event)

    def track_function_call(
        self,
        function_name: str,
        args: Any = None,
        duration_ns: Optional[int] = None,
    ):
        """
        Track a function call.

        Args:
            function_name: Name of the function
            args: Function arguments (optional)
            duration_ns: Optional duration in nanoseconds
        """
        ctx = get_context()
        if ctx is None:
            return

        # Capture caller location
        caller = inspect.currentframe()
        if caller and caller.f_back:
            frame = caller.f_back
            file = frame.f_code.co_filename
            line = frame.f_lineno
        else:
            file = "unknown"
            line = 0

        is_first_event = ctx.root_id is None

        event = self._capture_event(
            ctx,
            EventKind(
                FunctionCall={
                    "function_name": function_name,
                    "module": "app",
                    "args": args or {},
                    "file": file,
                    "line": line,
                }
            ),
            duration_ns
        )

        update_context(event.id, is_first_event)

    def track_function(
        self,
        function_name: str,
        args: Any,
        fn: Any,
    ):
        """
        Track a function with automatic duration measurement.

        Args:
            function_name: Name of the function
            args: Function arguments
            fn: Function to execute

        Returns:
            Function result
        """
        import time
        start = time.perf_counter_ns()

        try:
            result = fn()
            duration_ns = time.perf_counter_ns() - start
            self.track_function_call(function_name, args, duration_ns)
            return result
        except Exception as e:
            duration_ns = time.perf_counter_ns() - start
            self.track_function_call(function_name, args, duration_ns)
            raise e

    def track_http_request(
        self,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        body: Any = None
    ):
        """Track an HTTP request."""
        ctx = get_context()
        if ctx is None:
            return

        is_first_event = ctx.root_id is None

        event = self._capture_event(
            ctx,
            EventKind(
                HttpRequest={
                    "method": method,
                    "url": url,
                    "headers": headers or {},
                    "body": body,
                }
            )
        )

        update_context(event.id, is_first_event)

    def track_http_response(
        self,
        status: int,
        headers: Optional[Dict[str, str]] = None,
        body: Any = None,
        duration_ms: int = 0
    ):
        """Track an HTTP response."""
        ctx = get_context()
        if ctx is None:
            return

        # Convert duration from ms to ns for metadata
        duration_ns = duration_ms * 1_000_000

        event = self._capture_event(
            ctx,
            EventKind(
                HttpResponse={
                    "status": status,
                    "headers": headers or {},
                    "body": body,
                    "duration_ms": duration_ms,
                }
            ),
            duration_ns
        )

        update_context(event.id, False)

    def track_lock_acquire(self, lock_id: str, lock_type: str = "Mutex"):
        """
        Track a lock acquisition event.

        Args:
            lock_id: Unique identifier for this lock
            lock_type: Type of lock ("Mutex", "RWLock", "Semaphore", etc.)
        """
        ctx = get_context()
        if ctx is None:
            if self.config.debug:
                print("[Raceway] track_lock_acquire called outside of context", flush=True)
            return

        location = self._capture_location()
        is_first_event = ctx.root_id is None

        event = self._capture_event(
            ctx,
            EventKind(
                LockAcquire={
                    "lock_id": lock_id,
                    "lock_type": lock_type,
                    "location": location,
                }
            )
        )

        update_context(event.id, is_first_event)

    def track_lock_release(self, lock_id: str, lock_type: str = "Mutex"):
        """
        Track a lock release event.

        Args:
            lock_id: Unique identifier for this lock
            lock_type: Type of lock ("Mutex", "RWLock", "Semaphore", etc.)
        """
        ctx = get_context()
        if ctx is None:
            if self.config.debug:
                print("[Raceway] track_lock_release called outside of context", flush=True)
            return

        location = self._capture_location()
        is_first_event = ctx.root_id is None

        event = self._capture_event(
            ctx,
            EventKind(
                LockRelease={
                    "lock_id": lock_id,
                    "lock_type": lock_type,
                    "location": location,
                }
            )
        )

        update_context(event.id, is_first_event)

    def propagation_headers(self, extra_headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Build outbound headers for propagating the current trace."""
        ctx = get_context()
        if ctx is None:
            raise RuntimeError("Raceway propagation_headers() called outside of an active context")

        result = build_propagation_headers(
            trace_id=ctx.trace_id,
            current_span_id=ctx.span_id,
            tracestate=ctx.tracestate,
            clock_vector=ctx.clock_vector,
            service_name=self.config.service_name,
            instance_id=self.instance_id,
        )

        ctx.clock_vector = result.clock_vector
        ctx.distributed = True
        # Do NOT modify ctx.span_id - this context should keep using its own span ID
        # The child span ID is only for the downstream service in the headers

        headers = dict(result.headers)
        if extra_headers:
            headers.update(extra_headers)
        return headers

    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        """Perform an HTTP request with automatic Raceway propagation."""
        headers = kwargs.pop("headers", {}) or {}
        try:
            propagation = self.propagation_headers()
        except RuntimeError:
            propagation = {}
            if self.config.debug:
                print("[Raceway] propagation_headers called without active context; sending request without trace headers", flush=True)

        # Merge headers with preference to explicit headers
        merged_headers = {**propagation, **headers}
        response = self.session.request(method, url, headers=merged_headers, **kwargs)
        return response

    def _capture_event(self, ctx, kind: EventKind, duration_ns: Optional[int] = None) -> Event:
        """
        Internal: Capture an event.

        Args:
            ctx: RacewayContext
            kind: Event kind
            duration_ns: Optional duration in nanoseconds

        Returns:
            Created event
        """
        # Increment local clock component for distributed tracing
        ctx.clock_vector = increment_clock_vector(
            ctx.clock_vector,
            service_name=self.config.service_name,
            instance_id=self.instance_id,
        )

        # Build causality vector using updated clock
        causality_vector: List[Tuple[str, int]] = list(ctx.clock_vector)

        # Create event
        event = Event(
            id=str(uuid.uuid4()),
            trace_id=ctx.trace_id,
            parent_id=ctx.parent_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            kind=kind,
            metadata=self._build_metadata(ctx.execution_id, duration_ns),
            causality_vector=causality_vector,
            lock_set=[],
        )

        # Buffer event
        with self.lock:
            self.event_buffer.append(event)
            buffer_size = len(self.event_buffer)

            # Flush if batch size reached
            if buffer_size >= self.config.batch_size:
                threading.Thread(target=self.flush, daemon=True).start()

        if self.config.debug:
            kind_name = list(kind.__dict__.keys())[0] if hasattr(kind, '__dict__') else "Unknown"
            print(f"[Raceway] Buffered event {event.id[:8]} (buffer size: {buffer_size})", flush=True)
            print(f"[Raceway] Captured event {event.id[:8]}: {kind_name}", flush=True)

        return event

    def _build_metadata(self, execution_id: str, duration_ns: Optional[int] = None) -> EventMetadata:
        """Build event metadata."""
        ctx = get_context()

        metadata = EventMetadata(
            thread_id=execution_id,  # Use execution ID as thread ID
            process_id=os.getpid(),
            service_name=self.config.service_name,
            environment=self.config.environment,
            tags={"sdk_language": "python"},
            duration_ns=duration_ns,
            # Phase 2: Distributed tracing fields
            # Always set distributed metadata when we have a context (not gated by distributed flag)
            # This ensures entry-point services also create distributed spans
            instance_id=self.instance_id if ctx else None,
            distributed_span_id=ctx.span_id if ctx else None,
            upstream_span_id=ctx.parent_span_id if ctx else None,
        )

        # Debug logging for distributed tracing
        if self.config.debug and ctx:
            print(f"[Raceway] Distributed metadata: distributed={ctx.distributed}, "
                  f"instance_id={metadata.instance_id}, span_id={metadata.distributed_span_id}, "
                  f"upstream={metadata.upstream_span_id}")

        return metadata

    @staticmethod
    def _safe_hostname() -> str:
        try:
            return socket.gethostname()
        except Exception:
            return "instance"

    def _capture_location(self) -> str:
        """Capture location from stack trace."""
        stack = traceback.extract_stack()

        # Find the first frame that's not in the SDK
        for frame in reversed(stack[:-1]):  # Skip current frame
            if 'raceway' not in frame.filename:
                return f"{frame.filename}:{frame.lineno}"

        return "unknown:0"

    def flush(self):
        """Flush buffered events to the server."""
        with self.lock:
            if not self.event_buffer:
                return

            events = self.event_buffer[:]
            self.event_buffer.clear()

        if self.config.debug:
            print(f"[Raceway] Flushing {len(events)} events to {self.config.endpoint}/events", flush=True)

        try:
            # Convert events to dictionaries
            events_dict = []
            for event in events:
                event_dict = asdict(event)
                # Convert EventKind to proper format
                kind_dict = {}
                for key, value in event.kind.__dict__.items():
                    if value is not None:
                        kind_dict[key] = value
                event_dict['kind'] = kind_dict
                events_dict.append(event_dict)

            response = self.session.post(
                f"{self.config.endpoint}/events",
                json={"events": events_dict},
                timeout=10,
            )

            if response.status_code == 200:
                if self.config.debug:
                    print(f"[Raceway] Sent {len(events)} events", flush=True)
            else:
                print(f"[Raceway] Failed to send events: {response.status_code} - {response.text}", flush=True)
        except Exception as e:
            print(f"[Raceway] Error sending events: {e}", flush=True)

    def _auto_flush(self):
        """Auto-flush background thread."""
        while self.running:
            time.sleep(self.config.flush_interval)
            self.flush()

    def shutdown(self):
        """Shutdown the client."""
        self.running = False
        self.flush()
