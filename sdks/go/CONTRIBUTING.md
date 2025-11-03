# Contributing to Raceway Go SDK

Thank you for your interest in contributing to Raceway! This document outlines the development process, coding standards, and areas where we need help.

## 🚀 Getting Started

### Prerequisites

- Go 1.21 or higher
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/mode7labs/raceway.git
cd raceway/sdks/go

# Download dependencies
go mod download

# Run tests
go test ./...

# Run tests with coverage
go test -cover -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

### Project Structure

```
sdks/go/
├── raceway/           # Main SDK package
│   ├── client.go      # Core client implementation
│   ├── client_test.go # Client tests
│   ├── trace_context.go # W3C Trace Context handling
│   └── trace_context_test.go
├── go.mod             # Module definition
├── go.sum             # Dependency checksums
├── README.md          # Main documentation
└── CONTRIBUTING.md    # This file
```

## 🧪 Testing

We maintain comprehensive test coverage. All contributions must include tests.

### Running Tests

```bash
# Run all tests
go test ./...

# Run tests with verbose output
go test -v ./...

# Run specific test file
go test -run TestMiddleware

# Run with race detector
go test -race ./...

# Generate coverage report
go test -cover -coverprofile=coverage.out ./...
go tool cover -html=coverage.out -o coverage.html
```

### Test Categories

- **Unit Tests**: Test individual functions and methods
- **Integration Tests**: Test SDK interactions with mocked HTTP client
- **Middleware Tests**: Test HTTP middleware behavior
- **Context Tests**: Test context propagation and goroutine tracking

### Writing Tests

Follow the existing test patterns using table-driven tests:

```go
func TestSomething(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    string
        wantErr bool
    }{
        {
            name:  "valid input",
            input: "test",
            want:  "expected",
        },
        {
            name:    "invalid input",
            input:   "",
            wantErr: true,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := SomeFunction(tt.input)
            if (err != nil) != tt.wantErr {
                t.Errorf("SomeFunction() error = %v, wantErr %v", err, tt.wantErr)
                return
            }
            if got != tt.want {
                t.Errorf("SomeFunction() = %v, want %v", got, tt.want)
            }
        })
    }
}
```

## 📝 Coding Standards

### Go Style Guide

Follow the [Effective Go](https://golang.org/doc/effective_go) guidelines and [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md):

- Use `gofmt` for code formatting
- Run `go vet` to check for suspicious constructs
- Use `golangci-lint` for comprehensive linting
- Keep functions focused and small (< 50 lines)
- Document all exported functions, types, and constants

### Naming Conventions

- **Packages**: lowercase, single word (e.g., `raceway`)
- **Exported Types**: PascalCase (`Client`, `Config`)
- **Unexported Types**: camelCase (`tracedContext`)
- **Interfaces**: PascalCase, usually ending in `-er` (`Tracker`, `Flusher`)
- **Functions**: mixedCase (`NewClient`, `trackEvent`)
- **Constants**: PascalCase or UPPER_CASE for package-level constants

### Documentation

- Add godoc comments to all exported APIs
- Include code examples in documentation where helpful
- Keep comments concise but clear
- Use `// Example` comments for testable examples

Example:

```go
// TrackStateChange tracks a state change for a variable.
//
// Parameters:
//   - ctx: context.Context containing Raceway trace information
//   - variable: name of the variable being tracked
//   - oldValue: previous value (can be nil for reads)
//   - newValue: current value
//   - accessType: "Read" or "Write"
//
// Example:
//
//	client.TrackStateChange(ctx, "balance", 100, 150, "Write")
func (c *Client) TrackStateChange(ctx context.Context, variable string, oldValue, newValue interface{}, accessType string) {
    // Implementation
}
```

### Error Handling

- Return errors, don't panic (except for unrecoverable errors)
- Use `fmt.Errorf` with %w for error wrapping
- Check all errors
- Provide context in error messages

```go
if err != nil {
    return fmt.Errorf("failed to track event: %w", err)
}
```

## 🎯 Areas We Need Help

### High Priority

#### 1. Automatic Instrumentation via AST Rewriting

Add compile-time instrumentation similar to TypeScript's Babel plugin:

**Implementation approach:**
- Create a `go generate` tool
- Parse Go AST using `go/ast` and `go/parser`
- Insert tracking calls automatically
- Generate instrumented code

**Tasks**:
- Create `cmd/raceway-instrument` tool
- Implement AST visitor for function calls
- Add state change detection
- Generate source mappings

#### 2. gRPC Interceptors

Add first-class support for gRPC:

```go
import (
    "google.golang.org/grpc"
    raceway "github.com/mode-7/raceway-go"
)

func main() {
    client := raceway.NewClient(raceway.Config{...})

    // Unary interceptor
    server := grpc.NewServer(
        grpc.UnaryInterceptor(client.UnaryServerInterceptor()),
        grpc.StreamInterceptor(client.StreamServerInterceptor()),
    )
}
```

**Tasks**:
- Implement unary and stream interceptors
- Propagate trace context via metadata
- Track RPC method calls
- Add comprehensive tests

#### 3. Database Integration

Add helpers for popular Go database libraries:

```go
// database/sql integration
db := raceway.TrackSQL(sql.Open("postgres", connStr), client)

// GORM integration
db := raceway.TrackGORM(gorm.Open(...), client)

// Redis integration
rdb := raceway.TrackRedis(redis.NewClient(...), client)
```

**Tasks**:
- Wrap `database/sql` driver
- Intercept query execution
- Track query parameters and results
- Support: database/sql, GORM, sqlx, go-redis

#### 4. Context Deadline Tracking

Track when operations approach context deadlines:

```go
client.TrackDeadline(ctx, "payment_processing")
// Automatically warns if operation takes >80% of deadline
```

### Medium Priority

#### 5. Structured Logging Integration

Integrate with popular logging libraries:

```go
// Logrus integration
import racelogrus "github.com/mode-7/raceway-go/logrus"

logger := logrus.New()
logger.AddHook(racelogrus.NewHook(client))
```

**Tasks**:
- Create integrations for: logrus, zap, zerolog
- Automatically correlate logs with traces
- Include trace ID in log entries

#### 6. OpenTelemetry Bridge

Bridge Raceway events to OpenTelemetry:

```go
client := raceway.NewClient(raceway.Config{
    OpenTelemetry: true,
    OTelExporter:  otlphttp.New(...),
})
```

**Tasks**:
- Map Raceway events to OTel spans
- Support OTel exporters
- Bidirectional context propagation

#### 7. Prometheus Metrics

Export Raceway metrics to Prometheus:

```go
import raceprometheus "github.com/mode-7/raceway-go/prometheus"

prometheus.MustRegister(raceprometheus.NewCollector(client))
```

**Tasks**:
- Expose event counts by type
- Track buffer size and flush rate
- Monitor race condition counts

### Low Priority

#### 8. Performance Profiling Mode

Add lightweight profiling:

```go
client := raceway.NewClient(raceway.Config{
    Profiling:     true,
    SamplingRate:  0.1, // 10% sampling
})
```

#### 9. Gin Framework Integration

Add Gin-specific middleware:

```go
import racegin "github.com/mode-7/raceway-go/gin"

r := gin.Default()
r.Use(racegin.Middleware(client))
```

#### 10. Echo Framework Integration

Add Echo-specific middleware:

```go
import raceecho "github.com/mode-7/raceway-go/echo"

e := echo.New()
e.Use(raceecho.Middleware(client))
```

## 🔧 Development Workflow

### Making Changes

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Write code following Go best practices
   - Add tests for new functionality
   - Update documentation
   - Run `gofmt` and `go vet`

3. **Test your changes**:
   ```bash
   go test ./...
   go test -race ./...
   golangci-lint run
   ```

4. **Commit with clear messages**:
   ```bash
   git commit -m "feat: add gRPC interceptor support"
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

1. Ensure all tests pass (`go test ./...`)
2. Ensure race detector passes (`go test -race ./...`)
3. Update README.md with API changes
4. Add entries to CHANGELOG.md
5. Request review from maintainers
6. Address feedback
7. Squash commits if requested

### Review Criteria

PRs will be evaluated on:

- **Correctness**: Does it work as intended?
- **Tests**: Are there comprehensive tests?
- **Documentation**: Is it well-documented with godoc?
- **Performance**: Does it impact performance?
- **API Design**: Is the API idiomatic and intuitive?
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
- **Environment**: Go version, OS, SDK version
- **Logs**: Relevant error messages/logs

### Example Bug Report

```markdown
## Description
Middleware doesn't preserve request headers

## Reproduction
\`\`\`go
client := raceway.NewClient(raceway.Config{...})
handler := client.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    // r.Header.Get("X-Custom") is empty
}))
\`\`\`

## Expected
Custom headers should be preserved

## Actual
Headers are lost after middleware

## Environment
- Go: 1.21.0
- SDK: github.com/mode-7/raceway-go v0.1.0
- OS: Ubuntu 22.04
```

## 💡 Feature Requests

We welcome feature requests! Please:

1. Check if it already exists
2. Explain the use case
3. Provide examples
4. Consider implementation complexity

## 🏗️ Architecture Notes

### Context Propagation

We use `context.Context` for automatic trace propagation. This is the idiomatic Go approach and provides:

- Automatic context across function calls
- Goroutine-safe storage
- Request-scoped data
- Deadline and cancellation support

### Event Buffering

Events are buffered in memory and flushed periodically:

1. Events captured → Buffer (mutex-protected)
2. Buffer reaches `BatchSize` OR `FlushInterval` expires
3. HTTP POST to Raceway server
4. Retry on failure with exponential backoff

### Goroutine Tracking

Each goroutine gets a unique ID: `go-<pid>-<counter>`

- Counter is atomically incremented
- ID stored in `RacewayContext`
- Propagated via `context.Context`

## 📚 Resources

- [Main Raceway Repository](https://github.com/mode7labs/raceway)
- [Documentation](https://docs.raceway.dev)
- [Issue Tracker](https://github.com/mode7labs/raceway/issues)
- [Discussions](https://github.com/mode7labs/raceway/discussions)
- [Effective Go](https://golang.org/doc/effective_go)
- [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md)

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## ❓ Questions?

- Open a [Discussion](https://github.com/mode7labs/raceway/discussions)
- Join our community (if available)
- Email: dev@raceway.dev (if available)

Thank you for contributing to Raceway! 🎉
