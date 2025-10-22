"""Context management for Raceway SDK using contextvars."""

import os
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Optional, List, Tuple


@dataclass
class RacewayContext:
    """Context for tracking trace state across async/sync execution."""

    trace_id: str
    execution_id: str  # Unique ID for this execution chain (like goroutine ID)
    parent_id: Optional[str] = None
    root_id: Optional[str] = None
    clock: int = 0
    span_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    parent_span_id: Optional[str] = None
    distributed: bool = False
    clock_vector: List[Tuple[str, int]] = field(default_factory=list)
    tracestate: Optional[str] = None


# Context variable for automatic propagation (works with threading and asyncio)
_raceway_context: ContextVar[Optional[RacewayContext]] = ContextVar(
    'raceway_context',
    default=None
)


def create_context(
    trace_id: Optional[str] = None,
    *,
    span_id: Optional[str] = None,
    parent_span_id: Optional[str] = None,
    distributed: bool = False,
    clock_vector: Optional[List[Tuple[str, int]]] = None,
    tracestate: Optional[str] = None,
) -> RacewayContext:
    """
    Create a new Raceway context with unique execution ID.

    Args:
        trace_id: Trace ID to use (generates new UUID if not provided)

    Returns:
        New RacewayContext instance
    """
    if trace_id is None:
        trace_id = str(uuid.uuid4())

    # Generate unique execution ID using UUID (matching Node SDK approach)
    # Format: python-<pid>-<uuid-first-8-chars>
    execution_id = f"python-{os.getpid()}-{str(uuid.uuid4())[:8]}"

    return RacewayContext(
        trace_id=trace_id,
        execution_id=execution_id,
        parent_id=None,
        root_id=None,
        clock=0,
        span_id=span_id or uuid.uuid4().hex[:16],
        parent_span_id=parent_span_id,
        distributed=distributed,
        clock_vector=clock_vector.copy() if clock_vector else [],
        tracestate=tracestate,
    )


def set_context(ctx: RacewayContext) -> None:
    """Set the current Raceway context."""
    _raceway_context.set(ctx)


def get_context() -> Optional[RacewayContext]:
    """Get the current Raceway context."""
    return _raceway_context.get()


def update_context(event_id: str, is_first_event: bool) -> None:
    """
    Update the current context after capturing an event.

    Args:
        event_id: ID of the captured event
        is_first_event: Whether this is the first event in the execution chain
    """
    ctx = get_context()
    if ctx is None:
        return

    # Set root ID if this is the first event
    if is_first_event and ctx.root_id is None:
        ctx.root_id = event_id

    # Update parent ID and increment clock
    ctx.parent_id = event_id
    ctx.clock += 1
