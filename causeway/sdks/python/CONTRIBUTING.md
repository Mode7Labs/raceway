# Contributing to Raceway Python SDK

Thank you for your interest in contributing to the Raceway Python SDK! This document provides guidelines and information about potential enhancements.

## Development Setup

### Prerequisites

- Python 3.8 or higher
- pip or pip3

### Installation

```bash
# Clone the repository
cd sdks/python

# Install dependencies
pip install -r requirements.txt

# Install development dependencies
pip install pytest pytest-asyncio pytest-cov flask requests

# Run tests
python -m pytest -v
```

## Running Tests

```bash
# Run all tests
python -m pytest

# Run with verbose output
python -m pytest -v

# Run specific test file
python -m pytest tests/test_core_tracking.py -v

# Run with coverage
python -m pytest --cov=raceway --cov-report=html

# Run only unit tests
python -m pytest -m unit

# Run only middleware tests
python -m pytest -m middleware
```

## Building the Package

To build the Python package for distribution:

### Install Build Tools

```bash
# Install the build tool
python3 -m pip install build

# Optional: Install twine for uploading to PyPI
python3 -m pip install twine
```

### Build the Package

```bash
# Build source distribution and wheel
python3 -m build

# Output will be in dist/:
# - raceway-0.1.0.tar.gz (source distribution)
# - raceway-0.1.0-py3-none-any.whl (wheel)
```

### Verify the Build

```bash
# Check the distribution files
twine check dist/*

# Install locally from the wheel to test
pip install dist/raceway-0.1.0-py3-none-any.whl

# Or install in editable mode for development
pip install -e .
```

### Build Requirements

The build process requires:
- `pyproject.toml` - Build system configuration (PEP 517)
- `setup.py` or `setup.cfg` - Package metadata (if not using pyproject.toml exclusively)
- `build` tool - PEP 517 compliant build frontend

All dependencies are declared in `pyproject.toml`.

## Code Style

- Follow [PEP 8](https://peps.python.org/pep-0008/) style guidelines
- Use type hints where possible (PEP 484)
- Docstrings should follow [Google style](https://google.github.io/styleguide/pyguide.html#38-comments-and-docstrings)
- Maximum line length: 100 characters
- Use `black` for code formatting (optional but recommended)

### Type Hints Example

```python
from typing import Optional, Dict, Any

def track_state_change(
    self,
    variable: str,
    old_value: Any,
    new_value: Any,
    access_type: str = "Write"
) -> None:
    """Track a state change event."""
    pass
```

## Testing Guidelines

- Write tests for all new features
- Maintain or improve test coverage
- Use pytest fixtures from `tests/conftest.py`
- Use appropriate pytest markers (`@pytest.mark.unit`, `@pytest.mark.middleware`, etc.)

### Test Structure

```python
@pytest.mark.unit
class TestMyFeature:
    """Tests for my new feature."""

    def test_basic_functionality(self, mock_client, captured_events, raceway_context):
        """Should do something specific."""
        # Arrange
        expected_value = 42

        # Act
        mock_client.my_new_method(expected_value)

        # Assert
        assert len(captured_events) == 1
        assert captured_events[0].kind.MyEvent is not None
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Add tests for your changes
5. Ensure all tests pass
6. Update documentation if needed
7. Commit your changes (`git commit -m 'Add my feature'`)
8. Push to your fork (`git push origin feature/my-feature`)
9. Open a Pull Request

## Future Enhancement Opportunities

The Python SDK is actively being improved. Here are high-impact enhancements that contributors can work on:

### 1. 🎯 Python Decorators for Auto-Instrumentation

**Status**: Python has mature decorator support

Implement decorators for automatic tracking without manual instrumentation:

```python
from raceway import track_state, track_function

class BankAccount:
    @track_state(variable="balance")
    def __setattr__(self, name, value):
        super().__setattr__(name, value)

    @track_function()
    async def transfer(self, to: 'BankAccount', amount: float):
        self.balance -= amount  # Auto-tracked!
        to.balance += amount
```

**Implementation approach**:
- Create `raceway/decorators.py`
- Implement `@track_function()` decorator
- Implement `@track_state()` for class attributes
- Implement `@track_method()` for class methods
- Add tests in `tests/test_decorators.py`

**References**:
- PEP 318 - Decorators for Functions and Methods
- TypeScript SDK decorator implementation

### 2. 🔧 AST Transformation for Build-Time Instrumentation

**Status**: Python has powerful AST manipulation capabilities

Implement build-time instrumentation using Python's `ast` module:

```python
# raceway_transform.py
import ast

class RacewayTransformer(ast.NodeTransformer):
    def visit_Assign(self, node):
        # Inject tracking for assignments
        return ast.copy_location(
            self.create_tracking_call(node),
            node
        )
```

**Usage**:
```python
# Transform during import
import raceway.transform
raceway.transform.install()

# Or as a pytest plugin
# pytest.ini: plugins = raceway.pytest_plugin
```

**Implementation approach**:
- Create `raceway/ast_transform.py`
- Implement AST visitor for assignments, function calls, attribute access
- Create import hook for automatic transformation
- Add pytest plugin support
- Comprehensive tests

**References**:
- Python `ast` module documentation
- `import_hook` library for import-time transformation
- Babel plugin implementation from TypeScript SDK

### 3. 🔄 Async Context Management Improvements

**Status**: Python has `contextvars` (PEP 567)

Enhance async support with better context propagation:

```python
import asyncio
from raceway import RacewayClient, async_tracked

client = RacewayClient(config)

@async_tracked(client)
async def process_batch(items):
    async with asyncio.TaskGroup() as tg:
        for item in items:
            tg.create_task(process_item(item))  # Context propagates!
```

**Implementation approach**:
- Enhance `raceway/context.py` with async utilities
- Create `@async_tracked` decorator
- Add context propagation tests for `asyncio`, `trio`, `curio`
- Document async best practices

### 4. 📊 Advanced Lock Analysis

**Status**: Building on existing lock helpers

Add lock contention detection and deadlock analysis:

```python
from raceway import tracked_lock, LockAnalyzer

analyzer = LockAnalyzer(client)

with tracked_lock(client, lock1, "resource_a"):
    with tracked_lock(client, lock2, "resource_b"):
        # Analyzer detects potential deadlock patterns
        pass

# Get lock contention report
report = analyzer.get_contention_report()
print(f"Lock {report.most_contended} had {report.wait_time_ms}ms average wait")
```

**Implementation approach**:
- Extend lock tracking with wait time measurement
- Create `raceway/lock_analyzer.py`
- Implement contention detection
- Add deadlock pattern detection
- Comprehensive tests

### 5. 🌐 Framework Integrations

**Status**: Flask and FastAPI supported, more needed

Add first-class support for popular frameworks:

#### Django Support
```python
# settings.py
MIDDLEWARE = [
    'raceway.middleware.django.RacewayMiddleware',
    # ...
]
```

#### aiohttp Support
```python
from aiohttp import web
from raceway.middleware import aiohttp_middleware

app = web.Application(middlewares=[aiohttp_middleware(client)])
```

#### Celery Support
```python
from celery.signals import task_prerun, task_postrun
from raceway.celery import setup_raceway

setup_raceway(client)
```

**Implementation approach**:
- Create framework-specific middleware files
- Add distributed tracing across async tasks
- Comprehensive integration tests
- Documentation and examples

### 6. 🧪 Property-Based Testing

**Status**: Python has excellent property testing tools

Add property-based tests using Hypothesis:

```python
from hypothesis import given, strategies as st
from raceway import RacewayClient

@given(st.text(), st.integers(), st.integers())
def test_state_tracking_invariants(variable, old_val, new_val):
    """State tracking should maintain causality."""
    # Property: All events should have monotonically increasing clocks
    # Property: parent_id should always reference a previous event
    pass
```

**Implementation approach**:
- Add `hypothesis` to dev dependencies
- Create property-based tests for core invariants
- Test distributed tracing properties
- Document property testing approach

### 7. 📈 Performance Optimizations

Optimize hot paths for production use:

- **Lazy event serialization**: Only serialize events when flushing
- **Batch compression**: Compress event batches before sending
- **Zero-copy buffers**: Use `memoryview` for efficient buffering
- **C extension**: Implement critical paths in C/Cython

```python
# Example: Lazy serialization
class LazyEvent:
    def to_dict(self):
        if not self._serialized:
            self._serialized = self._serialize()
        return self._serialized
```

### 8. 🔐 Security Enhancements

**PII Redaction**:
```python
from raceway import Config, Redactor

config = Config(
    redactor=Redactor(
        patterns=[r'\d{16}', r'ssn:\d{9}'],  # Credit cards, SSNs
        fields=['password', 'api_key']
    )
)
```

**Implementation approach**:
- Create `raceway/redactor.py`
- Regex-based pattern matching
- Field-based redaction
- Configurable redaction strategies

### 9. 🎨 Enhanced Developer Experience

**Better Error Messages**:
```python
# Instead of: "RuntimeError: must be called within a Raceway context"
# Provide:
"""
RacewayContextError: track_state_change() called outside of Raceway context

Did you forget to:
  1. Initialize context with @raceway_context decorator?
  2. Set up middleware for Flask/FastAPI?
  3. Call create_context() manually?

See: https://docs.raceway.dev/python/context
"""
```

**Implementation approach**:
- Create custom exception types
- Add helpful error messages with suggestions
- Include documentation links
- Add debug mode with verbose output

### 10. 📚 Documentation Improvements

**Interactive Examples**:
- Jupyter notebook tutorials
- FastAPI example application
- Django example application
- Distributed tracing walkthrough

**API Reference**:
- Generate API docs with Sphinx
- Add type stubs (`.pyi` files) for better IDE support
- Document all public APIs with examples

### 11. 🧩 Plugin System

**Status**: New feature

Enable third-party extensions:

```python
from raceway import RacewayClient, Plugin

class CustomAnalysisPlugin(Plugin):
    def on_event(self, event):
        # Custom analysis logic
        pass

client = RacewayClient(config, plugins=[CustomAnalysisPlugin()])
```

**Implementation approach**:
- Create plugin interface
- Add plugin lifecycle hooks
- Event filtering and transformation
- Plugin marketplace/registry

### 12. 🔬 Advanced Debugging Tools

**Status**: New feature

Add debugging utilities:

```python
from raceway.debug import EventInspector, trace_replay

# Inspect events in real-time
inspector = EventInspector(client)
inspector.watch(variable="account.balance")

# Replay traces for debugging
trace_replay("trace-id-12345", step_by_step=True)
```

## Current Test Coverage

As of January 2025:

- **Total Tests**: 80 passing
- **Coverage**: ~85% (estimated)
- **Test Breakdown**:
  - Core tracking: 32 tests
  - Trace context: 23 tests
  - Middleware: 13 tests
  - Lock helpers: 13 tests

## Architecture Overview

```
raceway/
├── __init__.py          # Public API exports
├── client.py            # RacewayClient - main SDK interface
├── context.py           # Context management (contextvars)
├── middleware.py        # Flask/FastAPI middleware
├── lock_helpers.py      # Lock tracking utilities
├── trace_context.py     # W3C + vector clock propagation
└── types.py            # Data structures (Event, Config, etc.)

tests/
├── conftest.py              # Shared fixtures
├── test_core_tracking.py    # Core functionality tests
├── test_trace_context.py    # Distributed tracing tests
├── test_middleware.py       # Framework integration tests
└── test_lock_helpers.py     # Lock tracking tests
```

## Key Principles

1. **Zero Breaking Changes**: Maintain backward compatibility
2. **Performance First**: Minimal overhead in production
3. **Developer Experience**: Clear errors, great docs
4. **Production Ready**: Battle-tested, well-documented
5. **Type Safety**: Comprehensive type hints

## Questions?

- Check existing issues on GitHub
- Review the TypeScript SDK for reference implementations
- Reach out to maintainers for guidance

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
