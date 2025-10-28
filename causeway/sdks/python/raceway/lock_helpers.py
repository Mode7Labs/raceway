"""Lock tracking helpers for automatic acquire/release tracking."""

from contextlib import contextmanager
from typing import Any, Optional
from .context import get_context


@contextmanager
def tracked_lock(client, lock: Any, lock_id: str, lock_type: str = "Mutex"):
    """
    Context manager for automatic lock tracking.

    Automatically tracks lock acquire and release events, ensuring the
    release is tracked even if an exception occurs.

    Args:
        client: RacewayClient instance
        lock: Lock object (threading.Lock, asyncio.Lock, or any object with acquire()/release())
        lock_id: Unique identifier for this lock
        lock_type: Type of lock ("Mutex", "RWLock", "Semaphore", etc.)

    Usage:
        from threading import Lock
        my_lock = Lock()

        with raceway.tracked_lock(my_lock, "account_lock"):
            # Lock is automatically acquired and tracked
            account.balance -= amount
            # Lock is automatically released and tracked, even if exception occurs

    Raises:
        RuntimeError: If called outside of Raceway context
    """
    ctx = get_context()
    if ctx is None:
        raise RuntimeError(
            "tracked_lock() must be called within a Raceway context "
            "(e.g., inside a request handler with middleware installed)"
        )

    # Determine how to acquire the lock
    acquired = False
    try:
        # Try threading.Lock style (acquire/release)
        if hasattr(lock, 'acquire') and hasattr(lock, 'release'):
            lock.acquire()
            acquired = True
        # Try context manager style (__enter__/__exit__)
        elif hasattr(lock, '__enter__') and hasattr(lock, '__exit__'):
            lock.__enter__()
            acquired = True
        else:
            raise TypeError(
                f"Lock object {type(lock)} does not support acquire/release or context manager protocol"
            )

        # Track lock acquisition
        client.track_lock_acquire(lock_id, lock_type)

        yield

    finally:
        if acquired:
            # Track lock release
            client.track_lock_release(lock_id, lock_type)

            # Release the lock
            if hasattr(lock, 'release'):
                lock.release()
            elif hasattr(lock, '__exit__'):
                lock.__exit__(None, None, None)


def track_lock_acquire(client, lock_id: str, lock_type: str = "Mutex"):
    """
    Track a lock acquisition event.

    This is a lower-level method for manual lock tracking.
    Use tracked_lock() context manager for automatic tracking.

    Args:
        client: RacewayClient instance
        lock_id: Unique identifier for this lock
        lock_type: Type of lock ("Mutex", "RWLock", "Semaphore", etc.)
    """
    client.track_lock_acquire(lock_id, lock_type)


def track_lock_release(client, lock_id: str, lock_type: str = "Mutex"):
    """
    Track a lock release event.

    This is a lower-level method for manual lock tracking.
    Use tracked_lock() context manager for automatic tracking.

    Args:
        client: RacewayClient instance
        lock_id: Unique identifier for this lock
        lock_type: Type of lock ("Mutex", "RWLock", "Semaphore", etc.)
    """
    client.track_lock_release(lock_id, lock_type)
