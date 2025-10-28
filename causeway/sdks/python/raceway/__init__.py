"""
Raceway SDK - Python

Lightweight SDK for race condition detection in Python applications.

Example:
    >>> from raceway import RacewayClient, Config
    >>>
    >>> client = RacewayClient(Config(
    ...     endpoint="http://localhost:8080",
    ...     service_name="my-service",
    ... ))
    >>>
    >>> # Context is automatically managed by middleware
    >>> client.track_state_change("counter", 5, 6, "Write")
"""

from .client import RacewayClient
from .types import Config, Event, EventKind, EventMetadata
from .context import create_context, set_context, get_context
from .lock_helpers import tracked_lock, track_lock_acquire, track_lock_release
from .decorators import track_function, track_async, track_method

__all__ = [
    "RacewayClient",
    "Config",
    "Event",
    "EventKind",
    "EventMetadata",
    "create_context",
    "set_context",
    "get_context",
    "tracked_lock",
    "track_lock_acquire",
    "track_lock_release",
    "track_function",
    "track_async",
    "track_method",
]
__version__ = "0.1.0"
