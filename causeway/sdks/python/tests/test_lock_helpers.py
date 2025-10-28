"""Tests for lock tracking helpers."""

import pytest
from threading import Lock, RLock
from unittest.mock import Mock
from raceway import tracked_lock
from raceway.context import create_context, set_context


class MockLock:
    """Mock lock for testing."""

    def __init__(self):
        self.acquired = False
        self.released = False

    def acquire(self):
        if self.acquired:
            raise RuntimeError("Lock already acquired")
        self.acquired = True

    def release(self):
        if not self.acquired:
            raise RuntimeError("Lock not acquired")
        self.released = True
        self.acquired = False

    def is_locked(self):
        return self.acquired


class MockContextManagerLock:
    """Mock lock using context manager protocol."""

    def __init__(self):
        self.entered = False
        self.exited = False

    def __enter__(self):
        if self.entered:
            raise RuntimeError("Already entered")
        self.entered = True
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.exited = True
        self.entered = False
        return False


@pytest.mark.unit
class TestTrackedLock:
    """Tests for tracked_lock context manager."""

    def test_tracks_lock_acquire_and_release(self, mock_client, captured_events, raceway_context):
        """Should track both acquire and release events."""
        lock = MockLock()

        with tracked_lock(mock_client, lock, "test_lock", "Mutex"):
            pass

        # Should have tracked acquire and release
        assert len(captured_events) == 2

        acquire_event = captured_events[0]
        release_event = captured_events[1]

        assert acquire_event.kind.LockAcquire is not None
        assert acquire_event.kind.LockAcquire["lock_id"] == "test_lock"
        assert acquire_event.kind.LockAcquire["lock_type"] == "Mutex"

        assert release_event.kind.LockRelease is not None
        assert release_event.kind.LockRelease["lock_id"] == "test_lock"
        assert release_event.kind.LockRelease["lock_type"] == "Mutex"

    def test_acquires_and_releases_lock(self, mock_client, captured_events, raceway_context):
        """Should acquire and release the lock."""
        lock = MockLock()

        assert not lock.is_locked()

        with tracked_lock(mock_client, lock, "test_lock"):
            assert lock.is_locked()

        assert not lock.is_locked()

    def test_releases_lock_on_exception(self, mock_client, captured_events, raceway_context):
        """Should release lock even if exception occurs."""
        lock = MockLock()

        with pytest.raises(ValueError):
            with tracked_lock(mock_client, lock, "test_lock"):
                assert lock.is_locked()
                raise ValueError("Test error")

        # Lock should still be released
        assert not lock.is_locked()

        # Should have tracked both acquire and release
        assert len(captured_events) == 2
        assert captured_events[0].kind.LockAcquire is not None
        assert captured_events[1].kind.LockRelease is not None

    def test_works_with_threading_lock(self, mock_client, captured_events, raceway_context):
        """Should work with threading.Lock."""
        lock = Lock()

        was_locked = False

        with tracked_lock(mock_client, lock, "thread_lock"):
            was_locked = lock.locked()

        assert was_locked
        assert not lock.locked()
        assert len(captured_events) == 2

    def test_works_with_threading_rlock(self, mock_client, captured_events, raceway_context):
        """Should work with threading.RLock."""
        lock = RLock()

        was_locked = False

        with tracked_lock(mock_client, lock, "rlock"):
            was_locked = lock._is_owned()  # RLock internal method

        assert was_locked
        assert len(captured_events) == 2

    def test_works_with_context_manager_protocol(self, mock_client, captured_events, raceway_context):
        """Should work with objects supporting context manager protocol."""
        lock = MockContextManagerLock()

        with tracked_lock(mock_client, lock, "cm_lock"):
            assert lock.entered

        assert lock.exited
        assert len(captured_events) == 2

    def test_raises_error_outside_context(self, mock_client, captured_events):
        """Should raise error when called outside Raceway context."""
        lock = MockLock()

        with pytest.raises(RuntimeError, match="must be called within a Raceway context"):
            with tracked_lock(mock_client, lock, "test_lock"):
                pass

    def test_raises_error_for_unsupported_lock(self, mock_client, captured_events, raceway_context):
        """Should raise error for objects that don't support locking."""
        invalid_lock = "not a lock"

        with pytest.raises(TypeError, match="does not support"):
            with tracked_lock(mock_client, invalid_lock, "bad_lock"):
                pass

    def test_supports_different_lock_types(self, mock_client, captured_events, raceway_context):
        """Should support different lock type labels."""
        lock_types = ["Mutex", "RWLock", "Semaphore", "Custom"]

        for lock_type in lock_types:
            captured_events.clear()
            lock = MockLock()

            with tracked_lock(mock_client, lock, f"lock_{lock_type}", lock_type):
                pass

            assert captured_events[0].kind.LockAcquire["lock_type"] == lock_type
            assert captured_events[1].kind.LockRelease["lock_type"] == lock_type

    def test_can_be_nested(self, mock_client, captured_events, raceway_context):
        """Should support nested lock acquisition."""
        lock1 = MockLock()
        lock2 = MockLock()

        with tracked_lock(mock_client, lock1, "outer_lock"):
            assert lock1.is_locked()

            with tracked_lock(mock_client, lock2, "inner_lock"):
                assert lock2.is_locked()

            assert not lock2.is_locked()

        assert not lock1.is_locked()

        # Should have 4 events: acquire1, acquire2, release2, release1
        assert len(captured_events) == 4
        assert captured_events[0].kind.LockAcquire is not None
        assert captured_events[0].kind.LockAcquire["lock_id"] == "outer_lock"
        assert captured_events[1].kind.LockAcquire["lock_id"] == "inner_lock"
        assert captured_events[2].kind.LockRelease["lock_id"] == "inner_lock"
        assert captured_events[3].kind.LockRelease["lock_id"] == "outer_lock"


@pytest.mark.unit
class TestLockTrackingMethods:
    """Tests for manual lock tracking methods."""

    def test_track_lock_acquire(self, mock_client, captured_events, raceway_context):
        """Should track lock acquisition."""
        mock_client.track_lock_acquire("manual_lock", "Mutex")

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event.kind.LockAcquire is not None
        assert event.kind.LockAcquire["lock_id"] == "manual_lock"
        assert event.kind.LockAcquire["lock_type"] == "Mutex"

    def test_track_lock_release(self, mock_client, captured_events, raceway_context):
        """Should track lock release."""
        mock_client.track_lock_release("manual_lock", "RWLock")

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event.kind.LockRelease is not None
        assert event.kind.LockRelease["lock_id"] == "manual_lock"
        assert event.kind.LockRelease["lock_type"] == "RWLock"

    def test_manual_tracking_outside_context_no_error(self, mock_client, captured_events, raceway_context):
        """Should track when called with context."""
        # When context is available, should track
        mock_client.track_lock_acquire("lock", "Mutex")
        mock_client.track_lock_release("lock", "Mutex")

        assert len(captured_events) == 2
