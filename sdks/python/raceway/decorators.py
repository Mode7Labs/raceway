"""
Raceway Decorators for Automatic Tracking

Provides decorators to automatically track function calls, state changes,
and async operations without manual instrumentation.
"""

import functools
import inspect
import time
import asyncio
from typing import Any, Callable, Optional, List, TypeVar, cast
from .context import get_context
from .client import RacewayClient

F = TypeVar('F', bound=Callable[..., Any])


def track_function(
    client: Optional[RacewayClient] = None,
    *,
    name: Optional[str] = None,
    capture_args: bool = False,
    capture_result: bool = False
) -> Callable[[F], F]:
    """
    Decorator to automatically track function calls.

    Captures function entry and exit, including duration and optional
    argument/result capture.

    Args:
        client: RacewayClient instance. If None, must be set via thread-local.
        name: Custom name for the function. Defaults to qualified function name.
        capture_args: Whether to capture function arguments in metadata.
        capture_result: Whether to capture function result in metadata.

    Example:
        >>> @track_function(client)
        ... def process_payment(user_id: str, amount: float):
        ...     # Function entry/exit automatically tracked
        ...     return charge_card(user_id, amount)

        >>> @track_function(client, capture_args=True)
        ... def calculate_total(items: List[Item]):
        ...     # Arguments captured in event metadata
        ...     return sum(item.price for item in items)
    """
    def decorator(func: F) -> F:
        # Get qualified function name
        func_name = name or f"{func.__module__}.{func.__qualname__}"

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            ctx = get_context()
            if ctx is None:
                # No context, just run function without tracking
                return func(*args, **kwargs)

            # Get client from parameter or try to find it
            tracking_client = client
            if tracking_client is None:
                # Check if first argument is a class instance with _raceway_client
                if args and hasattr(args[0], '_raceway_client'):
                    tracking_client = args[0]._raceway_client

            if tracking_client is None:
                # No client available, run without tracking
                return func(*args, **kwargs)

            # Prepare metadata
            metadata = {}
            if capture_args:
                # Capture arguments (be careful with sensitive data!)
                sig = inspect.signature(func)
                bound_args = sig.bind(*args, **kwargs)
                bound_args.apply_defaults()
                metadata['args'] = {
                    k: repr(v) for k, v in bound_args.arguments.items()
                }

            # Track function entry
            start_time = time.time()
            tracking_client.track_function_call(func_name, metadata)

            try:
                # Execute function
                result = func(*args, **kwargs)

                # Track successful completion
                duration_ms = (time.time() - start_time) * 1000

                result_metadata = metadata.copy()
                if capture_result and result is not None:
                    result_metadata['result'] = repr(result)
                result_metadata['duration_ms'] = duration_ms
                result_metadata['status'] = 'success'

                tracking_client.track_function_call(
                    f"{func_name}:return",
                    result_metadata
                )

                return result

            except Exception as e:
                # Track error
                duration_ms = (time.time() - start_time) * 1000

                error_metadata = metadata.copy()
                error_metadata['duration_ms'] = duration_ms
                error_metadata['status'] = 'error'
                error_metadata['error'] = f"{type(e).__name__}: {str(e)}"

                tracking_client.track_function_call(
                    f"{func_name}:error",
                    error_metadata
                )

                raise

        return cast(F, wrapper)

    return decorator


def track_async(
    client: Optional[RacewayClient] = None,
    *,
    name: Optional[str] = None,
    capture_args: bool = False,
    capture_result: bool = False
) -> Callable[[F], F]:
    """
    Decorator to automatically track async function calls.

    Similar to @track_function but for async functions. Tracks async spawn
    and await operations.

    Args:
        client: RacewayClient instance.
        name: Custom name for the function.
        capture_args: Whether to capture function arguments.
        capture_result: Whether to capture function result.

    Example:
        >>> @track_async(client)
        ... async def fetch_user_data(user_id: str):
        ...     # Async spawn/await automatically tracked
        ...     data = await db.query(user_id)
        ...     return data
    """
    def decorator(func: F) -> F:
        if not asyncio.iscoroutinefunction(func):
            raise TypeError(f"{func.__name__} is not an async function")

        func_name = name or f"{func.__module__}.{func.__qualname__}"

        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            ctx = get_context()
            if ctx is None:
                return await func(*args, **kwargs)

            tracking_client = client
            if tracking_client is None and args and hasattr(args[0], '_raceway_client'):
                tracking_client = args[0]._raceway_client

            if tracking_client is None:
                return await func(*args, **kwargs)

            # Prepare metadata
            metadata = {}
            if capture_args:
                sig = inspect.signature(func)
                bound_args = sig.bind(*args, **kwargs)
                bound_args.apply_defaults()
                metadata['args'] = {
                    k: repr(v) for k, v in bound_args.arguments.items()
                }

            # Track async spawn
            start_time = time.time()
            tracking_client.track_function_call(f"{func_name}:spawn", metadata)

            try:
                # Execute async function
                result = await func(*args, **kwargs)

                # Track await completion
                duration_ms = (time.time() - start_time) * 1000

                result_metadata = metadata.copy()
                if capture_result and result is not None:
                    result_metadata['result'] = repr(result)
                result_metadata['duration_ms'] = duration_ms
                result_metadata['status'] = 'success'

                tracking_client.track_function_call(
                    f"{func_name}:await",
                    result_metadata
                )

                return result

            except Exception as e:
                # Track error
                duration_ms = (time.time() - start_time) * 1000

                error_metadata = metadata.copy()
                error_metadata['duration_ms'] = duration_ms
                error_metadata['status'] = 'error'
                error_metadata['error'] = f"{type(e).__name__}: {str(e)}"

                tracking_client.track_function_call(
                    f"{func_name}:error",
                    error_metadata
                )

                raise

        return cast(F, wrapper)

    return decorator


def track_method(
    client_attr: str = '_raceway_client',
    *,
    name: Optional[str] = None,
    capture_args: bool = False,
    capture_result: bool = False
) -> Callable[[F], F]:
    """
    Decorator to automatically track class method calls.

    Expects the class instance to have a RacewayClient attribute.

    Args:
        client_attr: Name of the attribute containing the RacewayClient.
        name: Custom name for the method.
        capture_args: Whether to capture method arguments.
        capture_result: Whether to capture method result.

    Example:
        >>> class BankAccount:
        ...     def __init__(self, raceway_client):
        ...         self._raceway_client = raceway_client
        ...         self.balance = 0
        ...
        ...     @track_method()
        ...     def deposit(self, amount: float):
        ...         # Method call automatically tracked
        ...         self.balance += amount
    """
    def decorator(func: F) -> F:
        func_name = name or func.__qualname__

        @functools.wraps(func)
        def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
            ctx = get_context()
            if ctx is None:
                return func(self, *args, **kwargs)

            # Get client from instance attribute
            tracking_client = getattr(self, client_attr, None)
            if tracking_client is None:
                return func(self, *args, **kwargs)

            # Prepare metadata
            metadata = {'class': self.__class__.__name__}
            if capture_args:
                sig = inspect.signature(func)
                # Skip 'self' parameter
                bound_args = sig.bind(self, *args, **kwargs)
                bound_args.apply_defaults()
                # Remove self from arguments
                args_dict = dict(bound_args.arguments)
                args_dict.pop('self', None)
                metadata['args'] = {k: repr(v) for k, v in args_dict.items()}

            # Track method entry
            start_time = time.time()
            tracking_client.track_function_call(func_name, metadata)

            try:
                # Execute method
                result = func(self, *args, **kwargs)

                # Track completion
                duration_ms = (time.time() - start_time) * 1000

                result_metadata = metadata.copy()
                if capture_result and result is not None:
                    result_metadata['result'] = repr(result)
                result_metadata['duration_ms'] = duration_ms
                result_metadata['status'] = 'success'

                tracking_client.track_function_call(
                    f"{func_name}:return",
                    result_metadata
                )

                return result

            except Exception as e:
                # Track error
                duration_ms = (time.time() - start_time) * 1000

                error_metadata = metadata.copy()
                error_metadata['duration_ms'] = duration_ms
                error_metadata['status'] = 'error'
                error_metadata['error'] = f"{type(e).__name__}: {str(e)}"

                tracking_client.track_function_call(
                    f"{func_name}:error",
                    error_metadata
                )

                raise

        return cast(F, wrapper)

    return decorator


__all__ = [
    'track_function',
    'track_async',
    'track_method',
]
