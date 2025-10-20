"""Raceway client implementation."""

import os
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
from .types import Config, Event, EventKind, EventMetadata


class RacewayClient:
    """Main Raceway SDK client."""

    def __init__(self, config: Optional[Config] = None):
        """Initialize the client."""
        self.config = config or Config()
        self.event_buffer: List[Event] = []
        self.lock = threading.RLock()
        self.session = requests.Session()
        self.running = True

        # Start auto-flush thread
        self.flush_thread = threading.Thread(target=self._auto_flush, daemon=True)
        self.flush_thread.start()

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
                print("[Raceway] track_state_change called outside of context")
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
        # Build causality vector
        causality_vector: List[Tuple[str, int]] = []
        if ctx.root_id is not None:
            causality_vector = [(ctx.root_id, ctx.clock)]

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

            # Flush if batch size reached
            if len(self.event_buffer) >= self.config.batch_size:
                threading.Thread(target=self.flush, daemon=True).start()

        if self.config.debug:
            kind_name = list(kind.__dict__.keys())[0] if hasattr(kind, '__dict__') else "Unknown"
            print(f"[Raceway] Captured event {event.id}: {kind_name}")

        return event

    def _build_metadata(self, execution_id: str, duration_ns: Optional[int] = None) -> EventMetadata:
        """Build event metadata."""
        return EventMetadata(
            thread_id=execution_id,  # Use execution ID as thread ID
            process_id=os.getpid(),
            service_name=self.config.service_name,
            environment=self.config.environment,
            tags={},
            duration_ns=duration_ns,
        )

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
                    print(f"[Raceway] Sent {len(events)} events")
            else:
                print(f"[Raceway] Failed to send events: {response.status_code} - {response.text}")
        except Exception as e:
            print(f"[Raceway] Error sending events: {e}")

    def _auto_flush(self):
        """Auto-flush background thread."""
        while self.running:
            time.sleep(self.config.flush_interval)
            self.flush()

    def shutdown(self):
        """Shutdown the client."""
        self.running = False
        self.flush()
