"""
Tests for Raceway Decorators

Tests the automatic tracking decorators: @track_function, @track_async, @track_method
"""

import pytest
import asyncio
from raceway import (
    RacewayClient,
    Config,
    track_function,
    track_async,
    track_method,
    create_context,
    set_context,
    get_context,
)


@pytest.fixture
def client(captured_events, mock_session, monkeypatch):
    """RacewayClient with event capture."""
    config = Config(
        endpoint="http://localhost:8080",
        service_name="test-service",
        batch_size=100,
        flush_interval=10.0,
        debug=False
    )
    client = RacewayClient(config)
    client.session = mock_session

    # Spy on _capture_event
    original_capture = client._capture_event

    def capture_event_spy(ctx, kind, duration_ns=None):
        event = original_capture(ctx, kind, duration_ns)
        captured_events.append(event)
        return event

    monkeypatch.setattr(client, '_capture_event', capture_event_spy)

    yield client
    client.running = False


@pytest.fixture
def context_setup():
    """Set up and tear down a raceway context."""
    ctx = create_context(
        trace_id="test-trace-123",
        span_id="test-span-456",
        parent_span_id=None,
        distributed=False,
        clock_vector=[],
        tracestate=None
    )
    set_context(ctx)
    yield ctx
    set_context(None)


# =============================================================================
# @track_function Tests
# =============================================================================


@pytest.mark.unit
class TestTrackFunction:
    """Tests for @track_function decorator."""

    def test_tracks_function_call(self, client, captured_events, context_setup):
        """Should track function entry and exit."""

        @track_function(client)
        def simple_function(x):
            return x * 2

        result = simple_function(5)

        assert result == 10
        assert len(captured_events) == 2

        # Entry event
        entry = captured_events[0]
        assert entry.kind.FunctionCall is not None
        assert "simple_function" in entry.kind.FunctionCall["function_name"]

        # Return event
        exit_event = captured_events[1]
        assert exit_event.kind.FunctionCall is not None
        assert ":return" in exit_event.kind.FunctionCall["function_name"]
        assert exit_event.kind.FunctionCall["args"]["status"] == "success"

    def test_captures_duration(self, client, captured_events, context_setup):
        """Should capture function duration."""

        @track_function(client)
        def timed_function():
            import time
            time.sleep(0.01)  # Sleep 10ms
            return "done"

        result = timed_function()

        assert result == "done"
        assert len(captured_events) == 2

        # Check duration in return event
        exit_event = captured_events[1]
        duration = exit_event.kind.FunctionCall["args"]["duration_ms"]
        assert duration >= 10.0  # At least 10ms

    def test_capture_args_option(self, client, captured_events, context_setup):
        """Should capture arguments when capture_args=True."""

        @track_function(client, capture_args=True)
        def func_with_args(x, y, z=10):
            return x + y + z

        result = func_with_args(1, 2, z=3)

        assert result == 6
        assert len(captured_events) == 2

        # Check args in entry event
        entry = captured_events[0]
        metadata = entry.kind.FunctionCall["args"]
        assert "args" in metadata
        assert "x" in metadata["args"]
        assert "y" in metadata["args"]
        assert "z" in metadata["args"]

    def test_capture_result_option(self, client, captured_events, context_setup):
        """Should capture result when capture_result=True."""

        @track_function(client, capture_result=True)
        def func_with_result():
            return {"status": "success", "value": 42}

        result = func_with_result()

        assert result == {"status": "success", "value": 42}
        assert len(captured_events) == 2

        # Check result in exit event
        exit_event = captured_events[1]
        metadata = exit_event.kind.FunctionCall["args"]
        assert "result" in metadata

    def test_custom_name_option(self, client, captured_events, context_setup):
        """Should use custom name when provided."""

        @track_function(client, name="custom.function.name")
        def my_function():
            return "test"

        result = my_function()

        assert result == "test"
        assert len(captured_events) == 2

        # Check custom name
        entry = captured_events[0]
        assert entry.kind.FunctionCall["function_name"] == "custom.function.name"

    def test_tracks_exceptions(self, client, captured_events, context_setup):
        """Should track exceptions with error status."""

        @track_function(client)
        def failing_function():
            raise ValueError("Something went wrong")

        with pytest.raises(ValueError, match="Something went wrong"):
            failing_function()

        assert len(captured_events) == 2

        # Entry event
        assert captured_events[0].kind.FunctionCall is not None

        # Error event
        error_event = captured_events[1]
        assert error_event.kind.FunctionCall is not None
        assert ":error" in error_event.kind.FunctionCall["function_name"]
        metadata = error_event.kind.FunctionCall["args"]
        assert metadata["status"] == "error"
        assert "ValueError" in metadata["error"]
        assert "duration_ms" in metadata

    def test_works_without_context(self, client, captured_events):
        """Should work gracefully without context (no tracking)."""

        @track_function(client)
        def no_context_function():
            return "result"

        # No context set
        result = no_context_function()

        assert result == "result"
        assert len(captured_events) == 0  # No tracking

    def test_works_without_client(self, captured_events, context_setup):
        """Should work gracefully without client (no tracking)."""

        @track_function()  # No client provided
        def no_client_function():
            return "result"

        result = no_client_function()

        assert result == "result"
        assert len(captured_events) == 0  # No tracking

    def test_preserves_function_metadata(self, client):
        """Should preserve function name and docstring."""

        @track_function(client)
        def documented_function(x, y):
            """This function does something."""
            return x + y

        assert documented_function.__name__ == "documented_function"
        assert documented_function.__doc__ == "This function does something."


# =============================================================================
# @track_async Tests
# =============================================================================


@pytest.mark.asyncio
@pytest.mark.unit
class TestTrackAsync:
    """Tests for @track_async decorator."""

    async def test_tracks_async_function(self, client, captured_events, context_setup):
        """Should track async function spawn and await."""

        @track_async(client)
        async def async_function(x):
            await asyncio.sleep(0.01)
            return x * 2

        result = await async_function(5)

        assert result == 10
        assert len(captured_events) == 2

        # Spawn event
        spawn = captured_events[0]
        assert spawn.kind.FunctionCall is not None
        assert ":spawn" in spawn.kind.FunctionCall["function_name"]

        # Await event
        await_event = captured_events[1]
        assert await_event.kind.FunctionCall is not None
        assert ":await" in await_event.kind.FunctionCall["function_name"]
        assert await_event.kind.FunctionCall["args"]["status"] == "success"

    async def test_captures_async_duration(self, client, captured_events, context_setup):
        """Should capture async function duration."""

        @track_async(client)
        async def timed_async():
            await asyncio.sleep(0.02)  # 20ms
            return "done"

        result = await timed_async()

        assert result == "done"
        await_event = captured_events[1]
        duration = await_event.kind.FunctionCall["args"]["duration_ms"]
        assert duration >= 20.0

    async def test_async_capture_args(self, client, captured_events, context_setup):
        """Should capture arguments in async functions."""

        @track_async(client, capture_args=True)
        async def async_with_args(name, count=1):
            return f"{name}: {count}"

        result = await async_with_args("test", count=5)

        assert result == "test: 5"
        spawn = captured_events[0]
        metadata = spawn.kind.FunctionCall["args"]
        assert "args" in metadata

    async def test_async_exception_tracking(self, client, captured_events, context_setup):
        """Should track exceptions in async functions."""

        @track_async(client)
        async def failing_async():
            await asyncio.sleep(0.01)
            raise RuntimeError("Async error")

        with pytest.raises(RuntimeError, match="Async error"):
            await failing_async()

        assert len(captured_events) == 2
        error_event = captured_events[1]
        assert ":error" in error_event.kind.FunctionCall["function_name"]
        assert error_event.kind.FunctionCall["args"]["status"] == "error"

    async def test_requires_async_function(self, client):
        """Should raise TypeError if decorating non-async function."""

        with pytest.raises(TypeError, match="not an async function"):

            @track_async(client)
            def not_async():
                return "error"


# =============================================================================
# @track_method Tests
# =============================================================================


@pytest.mark.unit
class TestTrackMethod:
    """Tests for @track_method decorator."""

    def test_tracks_method_call(self, client, captured_events, context_setup):
        """Should track method calls on class instances."""

        class TestClass:
            def __init__(self):
                self._raceway_client = client

            @track_method()
            def my_method(self, value):
                return value * 2

        obj = TestClass()
        result = obj.my_method(10)

        assert result == 20
        assert len(captured_events) == 2

        # Entry event
        entry = captured_events[0]
        assert entry.kind.FunctionCall is not None
        assert "my_method" in entry.kind.FunctionCall["function_name"]
        assert entry.kind.FunctionCall["args"]["class"] == "TestClass"

    def test_method_captures_args(self, client, captured_events, context_setup):
        """Should capture method arguments (excluding self)."""

        class Calculator:
            def __init__(self):
                self._raceway_client = client

            @track_method(capture_args=True)
            def add(self, x, y):
                return x + y

        calc = Calculator()
        result = calc.add(5, 3)

        assert result == 8
        entry = captured_events[0]
        metadata = entry.kind.FunctionCall["args"]
        assert "args" in metadata
        assert "self" not in metadata["args"]  # Should exclude self
        assert "x" in metadata["args"]
        assert "y" in metadata["args"]

    def test_method_custom_client_attr(self, client, captured_events, context_setup):
        """Should use custom client attribute name."""

        class CustomClass:
            def __init__(self):
                self.my_custom_client = client

            @track_method(client_attr='my_custom_client')
            def process(self):
                return "processed"

        obj = CustomClass()
        result = obj.process()

        assert result == "processed"
        assert len(captured_events) == 2

    def test_method_exception_tracking(self, client, captured_events, context_setup):
        """Should track exceptions in methods."""

        class FailingClass:
            def __init__(self):
                self._raceway_client = client

            @track_method()
            def fail(self):
                raise KeyError("Not found")

        obj = FailingClass()
        with pytest.raises(KeyError, match="Not found"):
            obj.fail()

        assert len(captured_events) == 2
        error_event = captured_events[1]
        assert error_event.kind.FunctionCall["args"]["status"] == "error"

    def test_method_without_client_attribute(self, captured_events, context_setup):
        """Should not track if instance lacks client attribute."""

        class NoClientClass:
            @track_method()
            def method(self):
                return "result"

        obj = NoClientClass()
        result = obj.method()

        assert result == "result"
        assert len(captured_events) == 0  # No tracking

    def test_method_capture_result(self, client, captured_events, context_setup):
        """Should capture method result when requested."""

        class DataProcessor:
            def __init__(self):
                self._raceway_client = client

            @track_method(capture_result=True)
            def transform(self, data):
                return {"transformed": data.upper()}

        processor = DataProcessor()
        result = processor.transform("hello")

        assert result == {"transformed": "HELLO"}
        exit_event = captured_events[1]
        assert "result" in exit_event.kind.FunctionCall["args"]


# =============================================================================
# Integration Tests
# =============================================================================


@pytest.mark.unit
class TestDecoratorIntegration:
    """Integration tests combining multiple decorators."""

    def test_nested_decorated_functions(self, client, captured_events, context_setup):
        """Should track nested function calls."""

        @track_function(client, name="outer")
        def outer_function(x):
            return inner_function(x * 2)

        @track_function(client, name="inner")
        def inner_function(y):
            return y + 10

        result = outer_function(5)

        assert result == 20  # (5*2) + 10
        # Should have 4 events: outer_entry, inner_entry, inner_exit, outer_exit
        assert len(captured_events) == 4

        assert "outer" in captured_events[0].kind.FunctionCall["function_name"]
        assert "inner" in captured_events[1].kind.FunctionCall["function_name"]
        assert "inner:return" in captured_events[2].kind.FunctionCall["function_name"]
        assert "outer:return" in captured_events[3].kind.FunctionCall["function_name"]

    def test_method_calling_decorated_function(self, client, captured_events, context_setup):
        """Should track method calling decorated function."""

        @track_function(client, name="helper")
        def helper_function(val):
            return val * 3

        class Service:
            def __init__(self):
                self._raceway_client = client

            @track_method(name="service.process")
            def process(self, x):
                return helper_function(x + 1)

        service = Service()
        result = service.process(2)

        assert result == 9  # (2+1)*3
        assert len(captured_events) == 4  # method_entry, func_entry, func_exit, method_exit

    @pytest.mark.asyncio
    async def test_async_calling_sync(self, client, captured_events, context_setup):
        """Should track async function calling sync function."""

        @track_function(client, name="sync_helper")
        def sync_helper(x):
            return x ** 2

        @track_async(client, name="async_caller")
        async def async_caller(val):
            result = sync_helper(val)
            await asyncio.sleep(0.001)
            return result

        result = await async_caller(4)

        assert result == 16
        assert len(captured_events) == 4  # async_spawn, sync_entry, sync_exit, async_await
