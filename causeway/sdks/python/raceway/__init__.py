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

__all__ = [
    "RacewayClient",
    "Config",
    "Event",
    "EventKind",
    "EventMetadata",
    "create_context",
    "set_context",
    "get_context",
]
__version__ = "0.1.0"
