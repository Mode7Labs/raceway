# Contributing to Raceway Rust SDK

Thank you for your interest in contributing to Raceway! This document outlines the development process, coding standards, and areas where we need help.

## 🚀 Getting Started

### Prerequisites

- Rust 1.70 or higher
- Cargo (comes with Rust)
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/mode-7/raceway.git
cd raceway/sdks/rust

# Build the SDK
cargo build

# Run tests
cargo test

# Run tests with output
cargo test -- --nocapture

# Check for clippy warnings
cargo clippy

# Format code
cargo fmt
```

### Project Structure

```
sdks/rust/
├── src/
│   ├── lib.rs           # Main library entry point
│   ├── client.rs        # Core client implementation
│   ├── event.rs         # Event types
│   ├── trace_context.rs # W3C Trace Context handling
│   └── middleware.rs    # Axum middleware
├── tests/
│   └── integration_test.rs # Integration tests
├── Cargo.toml           # Package manifest
├── README.md            # Main documentation
└── CONTRIBUTING.md      # This file
```

## 🧪 Testing

We maintain comprehensive test coverage. All contributions must include tests.

### Running Tests

```bash
# Run all tests
cargo test

# Run tests with output
cargo test -- --nocapture

# Run specific test
cargo test test_name

# Run doc tests
cargo test --doc

# Run with coverage (requires tarpaulin)
cargo install cargo-tarpaulin
cargo tarpaulin --out Html
```

### Test Categories

- **Unit Tests**: Test individual functions and methods
- **Integration Tests**: Test SDK interactions with mocked HTTP client
- **Doc Tests**: Test documentation examples
- **Middleware Tests**: Test Axum middleware behavior

### Writing Tests

Follow the existing test patterns:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_something() {
        let input = "test";
        let result = some_function(input);
        assert_eq!(result, "expected");
    }

    #[test]
    fn test_error_case() {
        let input = "";
        let result = some_function(input);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_async_function() {
        let result = async_function().await;
        assert!(result.is_ok());
    }
}
```

## 📝 Coding Standards

### Rust Style Guide

Follow the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) and [Rust Style Guide](https://doc.rust-lang.org/nightly/style-guide/):

- Use `rustfmt` for code formatting (automatically applied with `cargo fmt`)
- Run `clippy` for linting (`cargo clippy`)
- Follow naming conventions
- Document all public APIs with `///` doc comments
- Use `#[must_use]` for methods that return values that shouldn't be ignored

### Naming Conventions

- **Types**: PascalCase (`RacewayClient`, `TraceContext`)
- **Functions**: snake_case (`track_state_change`, `propagation_headers`)
- **Constants**: SCREAMING_SNAKE_CASE (`DEFAULT_BATCH_SIZE`)
- **Modules**: snake_case (`trace_context`, `middleware`)
- **Lifetimes**: lowercase single letters (`'a`, `'b`)

### Documentation

- Add doc comments (`///`) to all public APIs
- Include examples in documentation
- Use `# Examples` sections
- Document panics with `# Panics`
- Document errors with `# Errors`
- Document safety with `# Safety` for unsafe code

Example:

```rust
/// Tracks a state change for a variable.
///
/// This method records both the old and new values of a variable,
/// along with the access type (Read or Write).
///
/// # Arguments
///
/// * `variable` - Name of the variable being tracked
/// * `old_value` - Previous value (use `None` for reads)
/// * `new_value` - Current value
/// * `access_type` - Either "Read" or "Write"
///
/// # Examples
///
/// ```
/// use raceway_sdk::RacewayClient;
///
/// let client = RacewayClient::new("http://localhost:8080", "my-service");
/// client.track_state_change("balance", Some(100), 150, "Write");
/// ```
///
/// # Panics
///
/// This method will panic if called outside of a Raceway context.
pub fn track_state_change<T: Serialize>(
    &self,
    variable: &str,
    old_value: Option<T>,
    new_value: T,
    access_type: &str,
) {
    // Implementation
}
```

### Error Handling

- Use `Result<T, E>` for fallible operations
- Create custom error types with `thiserror` or `anyhow`
- Avoid panicking in library code (use `Result` instead)
- Use `?` operator for error propagation
- Provide meaningful error messages

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum RacewayError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("Context not available: {0}")]
    ContextError(String),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
}
```

## 🎯 Areas We Need Help

### High Priority

#### 1. Procedural Macro for Auto-Instrumentation

Create proc macros for automatic instrumentation:

```rust
use raceway_sdk::track;

#[track] // Automatically tracks function calls
async fn process_payment(amount: i64) -> Result<(), Error> {
    // Function is automatically instrumented
}

#[derive(Track)] // Automatically tracks field access
struct BankAccount {
    #[track(read, write)]
    balance: i64,

    #[track(read)]
    account_id: String,
}
```

**Implementation Tasks**:
- Create `raceway-macros` crate
- Implement `#[track]` attribute macro
- Implement `#[derive(Track)]` derive macro
- Add syn/quote dependencies
- Generate tracking code at compile time

**Files to Create**:
- `raceway-macros/src/lib.rs` - Macro implementations
- `raceway-macros/Cargo.toml` - Macro crate manifest
- Update `Cargo.toml` to depend on macros

#### 2. Actix-Web Integration

Add support for Actix-Web framework:

```rust
use actix_web::{web, App, HttpServer};
use raceway_sdk::actix::RacewayMiddleware;

#[actix_web::main]
async fn main() {
    let client = Arc::new(RacewayClient::new(...));

    HttpServer::new(move || {
        App::new()
            .wrap(RacewayMiddleware::new(client.clone()))
            .route("/api/handler", web::post().to(handler))
    })
    .bind("0.0.0.0:3000")?
    .run()
    .await
}
```

**Tasks**:
- Create `actix.rs` module
- Implement Actix middleware
- Handle request/response interception
- Add comprehensive tests

#### 3. Rocket Framework Integration

Add support for Rocket framework:

```rust
use rocket::{State, routes};
use raceway_sdk::rocket::RacewayFairing;

#[launch]
fn rocket() -> _ {
    let client = Arc::new(RacewayClient::new(...));

    rocket::build()
        .attach(RacewayFairing::new(client.clone()))
        .manage(client)
        .mount("/", routes![handler])
}
```

#### 4. Database Integration

Add helpers for popular Rust database libraries:

```rust
// SQLx integration
use raceway_sdk::sqlx::track_query;

let result = track_query(&client, sqlx::query!("SELECT * FROM users"))
    .fetch_all(&pool)
    .await?;

// Diesel integration
use raceway_sdk::diesel::TrackableConnection;

let conn = establish_connection().track(&client);
```

**Tasks**:
- Integrate with SQLx
- Integrate with Diesel
- Integrate with SeaORM
- Track query execution time
- Track query parameters

### Medium Priority

#### 5. Tracing Integration

Integrate with the `tracing` ecosystem:

```rust
use raceway_sdk::tracing::RacewaySubscriber;
use tracing_subscriber::layer::SubscriberExt;

let subscriber = tracing_subscriber::registry()
    .with(RacewaySubscriber::new(client));

tracing::subscriber::set_global_default(subscriber)?;
```

**Tasks**:
- Implement `tracing::Subscriber`
- Correlate spans with Raceway traces
- Include trace ID in span metadata

#### 6. OpenTelemetry Bridge

Bridge Raceway events to OpenTelemetry:

```rust
let client = RacewayClient::builder()
    .endpoint("http://localhost:8080")
    .service_name("my-service")
    .with_otel_exporter(opentelemetry_otlp::new_exporter())
    .build();
```

**Tasks**:
- Map Raceway events to OTel spans
- Support OTel exporters
- Bidirectional context propagation

#### 7. Metrics Export

Export metrics to Prometheus:

```rust
use raceway_sdk::metrics::PrometheusExporter;

let exporter = PrometheusExporter::new(&client);
let registry = prometheus::Registry::new();
registry.register(Box::new(exporter))?;
```

**Tasks**:
- Expose event counts by type
- Track buffer size and flush rate
- Monitor race condition counts

### Low Priority

#### 8. Warp Framework Integration

Add support for Warp framework:

```rust
use warp::Filter;
use raceway_sdk::warp::with_raceway;

let routes = warp::path("api")
    .and(with_raceway(client.clone()))
    .and_then(handler);
```

#### 9. Tower Integration

Create Tower middleware:

```rust
use tower::ServiceBuilder;
use raceway_sdk::tower::RacewayLayer;

let service = ServiceBuilder::new()
    .layer(RacewayLayer::new(client))
    .service(inner_service);
```

#### 10. Async-GraphQL Integration

Add GraphQL integration:

```rust
use async_graphql::*;
use raceway_sdk::graphql::RacewayExtension;

let schema = Schema::build(Query, Mutation, EmptySubscription)
    .extension(RacewayExtension::new(client))
    .finish();
```

## 🔧 Development Workflow

### Making Changes

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Write code following Rust best practices
   - Add tests for new functionality
   - Update documentation
   - Run `cargo fmt` and `cargo clippy`

3. **Test your changes**:
   ```bash
   cargo test
   cargo clippy
   cargo fmt --check
   ```

4. **Commit with clear messages**:
   ```bash
   git commit -m "feat: add actix-web middleware support"
   ```

   Use conventional commits:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `test:` - Test additions/changes
   - `refactor:` - Code refactoring
   - `perf:` - Performance improvements
   - `chore:` - Maintenance tasks

5. **Push and create PR**:
   ```bash
   git push origin feature/your-feature-name
   ```

### Pull Request Process

1. Ensure all tests pass (`cargo test`)
2. Ensure no clippy warnings (`cargo clippy`)
3. Ensure code is formatted (`cargo fmt`)
4. Update README.md with API changes
5. Add entries to CHANGELOG.md
6. Request review from maintainers
7. Address feedback
8. Squash commits if requested

### Review Criteria

PRs will be evaluated on:

- **Correctness**: Does it work as intended?
- **Tests**: Are there comprehensive tests?
- **Documentation**: Is it well-documented with rustdoc?
- **Performance**: Does it impact performance?
- **API Design**: Is the API idiomatic and ergonomic?
- **Safety**: Is unsafe code justified and documented?
- **Backward Compatibility**: Does it break existing code?

## 🐛 Bug Reports

### Before Submitting

1. Check existing issues
2. Verify it's not a configuration issue
3. Test with latest version
4. Create minimal reproduction

### What to Include

- **Description**: Clear description of the bug
- **Reproduction**: Minimal code to reproduce
- **Expected**: What should happen
- **Actual**: What actually happens
- **Environment**: Rust version, OS, SDK version, tokio version
- **Logs**: Relevant error messages/logs

### Example Bug Report

```markdown
## Description
Middleware panics when trace context is missing

## Reproduction
\`\`\`rust
let client = Arc::new(RacewayClient::new(...));
let app = Router::new()
    .route("/test", get(handler))
    .layer(axum::middleware::from_fn_with_state(
        client.clone(),
        RacewayClient::middleware,
    ));
// Panics when accessing /test without trace headers
\`\`\`

## Expected
Should handle missing context gracefully

## Actual
Thread panics with "Context not available"

## Environment
- Rust: 1.75.0
- SDK: raceway-sdk 0.1.0
- Tokio: 1.35.0
- OS: macOS 14.0
```

## 💡 Feature Requests

We welcome feature requests! Please:

1. Check if it already exists
2. Explain the use case
3. Provide examples
4. Consider implementation complexity

## 🏗️ Architecture Notes

### Context Propagation

We use `tokio::task_local!` for context propagation in async Rust. This provides:

- Task-local storage (similar to thread-local)
- Automatic propagation across `.await` points
- Type-safe context access
- Zero-cost abstraction

### Event Buffering

Events are buffered using:

1. Events captured → `Arc<Mutex<Vec<Event>>>`
2. Background task flushes every 1 second
3. HTTP POST to Raceway server (using `reqwest`)
4. Tokio channels for async coordination

### Memory Safety

- All shared state uses `Arc<Mutex<T>>`
- No unsafe code in public API
- All panics are documented
- Resource cleanup via `Drop` implementation

## 📚 Resources

- [Main Raceway Repository](https://github.com/mode-7/raceway)
- [Documentation](https://docs.raceway.dev)
- [Issue Tracker](https://github.com/mode-7/raceway/issues)
- [Discussions](https://github.com/mode-7/raceway/discussions)
- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- [The Rust Programming Language](https://doc.rust-lang.org/book/)
- [Async Rust](https://rust-lang.github.io/async-book/)

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## ❓ Questions?

- Open a [Discussion](https://github.com/mode-7/raceway/discussions)
- Join our community (if available)
- Email: dev@raceway.dev (if available)

Thank you for contributing to Raceway! 🎉
