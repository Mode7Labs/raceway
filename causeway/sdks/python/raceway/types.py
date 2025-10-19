"""Event types and structures for Raceway SDK."""

import os
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict


@dataclass
class Config:
    """Raceway client configuration."""
    endpoint: str = "http://localhost:8080"
    service_name: str = "unknown-service"
    environment: str = field(default_factory=lambda: os.getenv("ENV", "development"))
    batch_size: int = 50
    flush_interval: float = 1.0  # seconds
    debug: bool = False


@dataclass
class EventMetadata:
    """Event metadata."""
    thread_id: str
    process_id: int
    service_name: str
    environment: str
    tags: Dict[str, str] = field(default_factory=dict)
    duration_ns: Optional[int] = None


@dataclass
class StateChangeData:
    """State change event data."""
    variable: str
    old_value: Any
    new_value: Any
    location: str
    access_type: str  # "Read" or "Write"


@dataclass
class FunctionCallData:
    """Function call event data."""
    function_name: str
    module: str
    args: Any
    file: str
    line: int


@dataclass
class FunctionReturnData:
    """Function return event data."""
    function_name: str
    return_value: Any
    file: str
    line: int


@dataclass
class AsyncSpawnData:
    """Async spawn event data."""
    task_id: str
    task_name: str
    spawned_at: str


@dataclass
class AsyncAwaitData:
    """Async await event data."""
    future_id: str
    awaited_at: str


@dataclass
class LockAcquireData:
    """Lock acquire event data."""
    lock_id: str
    lock_type: str
    location: str


@dataclass
class LockReleaseData:
    """Lock release event data."""
    lock_id: str
    location: str


@dataclass
class HTTPRequestData:
    """HTTP request event data."""
    method: str
    url: str
    headers: Dict[str, str]
    body: Optional[Any] = None


@dataclass
class HTTPResponseData:
    """HTTP response event data."""
    status: int
    headers: Dict[str, str]
    body: Optional[Any]
    duration_ms: int


@dataclass
class ErrorData:
    """Error event data."""
    error_type: str
    message: str
    stack_trace: List[str]


@dataclass
class EventKind:
    """Event kind wrapper (only one field should be set)."""
    StateChange: Optional[Dict[str, Any]] = None
    FunctionCall: Optional[Dict[str, Any]] = None
    FunctionReturn: Optional[Dict[str, Any]] = None
    HttpRequest: Optional[Dict[str, Any]] = None
    HttpResponse: Optional[Dict[str, Any]] = None
    AsyncSpawn: Optional[Dict[str, Any]] = None
    AsyncAwait: Optional[Dict[str, Any]] = None
    LockAcquire: Optional[Dict[str, Any]] = None
    LockRelease: Optional[Dict[str, Any]] = None
    Error: Optional[Dict[str, Any]] = None


@dataclass
class Event:
    """Instrumentation event."""
    id: str
    trace_id: str
    parent_id: Optional[str]
    timestamp: str
    kind: EventKind
    metadata: EventMetadata
    causality_vector: List[Tuple[str, int]] = field(default_factory=list)
    lock_set: List[str] = field(default_factory=list)
