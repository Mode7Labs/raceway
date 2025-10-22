# raceway-go

Official Go SDK for Raceway - Race condition detection for Go applications.

## Features

- **🔌 Zero-Config Middleware**: Automatic trace initialization and goroutine tracking
- **🎯 Idiomatic Go**: Uses standard `context.Context` for seamless integration
- **🐛 Race Detection**: Detect data races, atomicity violations, and concurrency bugs
- **📊 Distributed Tracing**: Track causality across goroutines and services
- **⚡ Production-Ready**: Low overhead with automatic batching and background flushing
- **🔍 Automatic Goroutine Tracking**: No manual goroutine ID management required

## Installation

```bash
go get github.com/mode-7/raceway-go
```

## Quick Start

### 1. Initialize & Add Middleware

```go
package main

import (
    "net/http"
    raceway "github.com/mode-7/raceway-go"
)

func main() {
    // Initialize Raceway client
    client := raceway.NewClient(raceway.Config{
        ServerURL:   "http://localhost:8080",
        ServiceName: "my-service",
        Environment: "production",
    })
    defer client.Stop()

    // Create router
    mux := http.NewServeMux()
    mux.HandleFunc("/api/transfer", transferHandler(client))

    // Wrap with Raceway middleware (handles goroutine tracking automatically)
    handler := client.Middleware(mux)

    http.ListenAndServe(":3000", handler)
}
```

### 2. Track Events in Handlers

```go
func transferHandler(client *raceway.Client) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        startTime := time.Now()

        // Track function call
        client.TrackFunctionCall(ctx, "transfer", map[string]interface{}{
            "from":   "alice",
            "to":     "bob",
            "amount": 100,
        })

        // Read balance
        balance := getBalance("alice")
        client.TrackStateChange(ctx, "alice.balance", nil, balance, "Read")

        if balance < 100 {
            client.TrackHTTPResponse(ctx, 400, uint64(time.Since(startTime).Milliseconds()))
            w.WriteHeader(http.StatusBadRequest)
            return
        }

        // Update balance (RACE CONDITION WINDOW!)
        setBalance("alice", balance-100)
        client.TrackStateChange(ctx, "alice.balance", balance, balance-100, "Write")

        client.TrackHTTPResponse(ctx, 200, uint64(time.Since(startTime).Milliseconds()))
        w.WriteHeader(http.StatusOK)
    }
}
```

## Gin Framework Integration

```go
package main

import (
    "github.com/gin-gonic/gin"
    "github.com/google/uuid"
    raceway "github.com/mode-7/raceway-go"
)

func main() {
    // Initialize Raceway
    client := raceway.NewClient(raceway.Config{
        ServerURL:   "http://localhost:8080",
        ServiceName: "banking-api",
        Environment: "development",
        Debug:       true,
    })
    defer client.Stop()

    router := gin.Default()

    // Add Raceway middleware for Gin
    router.Use(ginRacewayMiddleware(client))

    router.POST("/api/transfer", transferHandler(client))
    router.Run(":3000")
}

// Gin middleware wrapper
func ginRacewayMiddleware(client *raceway.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Extract or generate trace ID
        traceID := c.GetHeader("X-Trace-ID")
        if traceID == "" {
            traceID = uuid.New().String()
        }

        // Create Raceway context (automatically generates unique goroutine ID)
        raceCtx := raceway.NewRacewayContext(traceID)
        ctx := raceway.WithRacewayContext(c.Request.Context(), raceCtx)

        // Track HTTP request
        client.TrackFunctionCall(ctx, "http_request", map[string]interface{}{
            "method": c.Request.Method,
            "path":   c.Request.URL.Path,
        })

        // Update request context
        c.Request = c.Request.WithContext(ctx)

        // Continue with request
        c.Next()

        // Track HTTP response
        duration := uint64(time.Since(start).Milliseconds())
        client.TrackHTTPResponse(ctx, c.Writer.Status(), duration)
    }
}
```

## API Reference

### `raceway.NewClient(config)`

Creates a new Raceway client instance.

**Config Options:**

```go
type Config struct {
    ServerURL     string            // Raceway server URL (required)
    ServiceName   string            // Service identifier (default: "unknown-service")
    InstanceID    string            // Optional instance identifier for distributed tracing
    Environment   string            // Environment (default: "development")
    BatchSize     int               // Event batch size (default: 100)
    FlushInterval time.Duration     // Flush interval (default: 1 second)
    Tags          map[string]string // Custom tags for all events
    Debug         bool              // Debug logging (default: false)
}
```

### Core Methods

All methods accept `context.Context` as the first parameter. The SDK automatically tracks goroutine IDs for race detection.

#### `client.Middleware(next http.Handler) http.Handler`

Returns HTTP middleware for automatic trace initialization. Each request gets a unique goroutine ID automatically.

#### `client.TrackStateChange(ctx, variable, oldValue, newValue, accessType)`

Track a variable read or write.

```go
// Track a read
client.TrackStateChange(ctx, "counter", nil, 5, "Read")

// Track a write
client.TrackStateChange(ctx, "counter", 5, 6, "Write")
```

#### `client.TrackFunctionCall(ctx, functionName, args)`

Track a function entry with arguments (no duration tracking).

```go
client.TrackFunctionCall(ctx, "processPayment", map[string]interface{}{
    "userId": 123,
    "amount": 50,
})
```

#### `client.StartFunction(ctx, functionName, args) func()`

**Recommended**: Track a function with automatic duration measurement. Returns a function to be called with `defer`.

```go
func transferHandler(client *raceway.Client) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()

        // Automatically measures duration from this line until function returns
        defer client.StartFunction(ctx, "transfer", map[string]interface{}{
            "from":   "alice",
            "to":     "bob",
            "amount": 100,
        })()

        // Your function logic here...
    }
}
```

#### `client.TrackHTTPResponse(ctx, status, durationMs)`

Track an HTTP response with status code and duration.

```go
duration := uint64(time.Since(startTime).Milliseconds())
client.TrackHTTPResponse(ctx, 200, duration)
```

#### `client.PropagationHeaders(ctx, extraHeaders)`

Generate outbound headers (`traceparent`, `tracestate`, and `raceway-clock`) for propagating the current trace across service boundaries.

```go
headers, err := client.PropagationHeaders(ctx, map[string]string{"X-Service": "payments"})
if err == nil {
    req, _ := http.NewRequestWithContext(ctx, http.MethodPost, ledgerURL, body)
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    http.DefaultClient.Do(req)
}
```

Call this inside a request after the middleware has initialised the Raceway context; it returns an error if no context is active.

### Context Management

#### `raceway.NewRacewayContext(traceID) *RacewayContext`

Create a new Raceway context for a trace. Automatically generates a unique goroutine ID.

```go
raceCtx := raceway.NewRacewayContext(traceID)
```

#### `raceway.WithRacewayContext(ctx, raceCtx) context.Context`

Add Raceway context to a standard Go context.

```go
ctx := raceway.WithRacewayContext(r.Context(), raceCtx)
```

#### `raceway.GetRacewayContext(ctx) *RacewayContext`

Extract Raceway context from a standard Go context.

```go
raceCtx := raceway.GetRacewayContext(ctx)
```

### Lifecycle Methods

#### `client.Stop()`

Stop the client and flush remaining events. Always call this before exiting.

```go
defer client.Stop()
```

## How Goroutine Tracking Works

The SDK automatically assigns a unique identifier to each execution chain (goroutine):

1. When `NewRacewayContext()` is called, the SDK generates a unique goroutine ID: `go-<pid>-<counter>`
2. This ID is stored in the `RacewayContext` and used for all events in that chain
3. Raceway uses these IDs to detect concurrent access from different goroutines
4. **You don't need to manage goroutine IDs manually** - everything is automatic!

Example: Two concurrent HTTP requests will get IDs like `go-12345-1` and `go-12345-2`, allowing Raceway to detect when they access the same data concurrently.

## Concurrent Request Tracing

To analyze concurrent operations together, use the same trace ID:

```bash
# Send concurrent requests with the same trace ID
TRACE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

curl -X POST http://localhost:3000/api/transfer \
  -H "X-Trace-ID: $TRACE_ID" \
  -d '{"from":"alice","to":"bob","amount":100}' &

curl -X POST http://localhost:3000/api/transfer \
  -H "X-Trace-ID: $TRACE_ID" \
  -d '{"from":"alice","to":"charlie","amount":200}' &

wait

# View in Raceway UI
echo "View trace: http://localhost:8080/traces/$TRACE_ID"
```

## Complete Example

See [`../../examples/go-banking`](../../examples/go-banking) for a complete working banking API that demonstrates:
- Gin framework integration
- Concurrent transfer handling
- Race condition detection
- Audit trail visualization
- Test script for triggering races

Run the example:

```bash
cd examples/go-banking

# Start Raceway server
cd ../.. && cargo run --release -- serve &

# Start the banking API
cd examples/go-banking
go run main.go

# Trigger a race condition
bash test.sh

# View results at http://localhost:8080
```

## Best Practices

1. **Always Pass Context**: Ensure `context.Context` flows through your entire call chain
2. **Use Middleware**: Set up Raceway middleware on your router for automatic initialization
3. **Track Shared State**: Focus tracking on shared mutable state that's accessed by multiple goroutines
4. **Same Trace ID for Concurrent Ops**: Use the same trace ID when analyzing concurrent operations
5. **Graceful Shutdown**: Always call `client.Stop()` before exiting to flush remaining events

## Troubleshooting

### No Races Detected

If races aren't being detected:
- Ensure concurrent requests use the **same trace ID** (via `X-Trace-ID` header)
- Verify that `TrackStateChange` is called for both reads and writes
- Check that the Raceway server is running and accessible
- Enable debug mode: `Debug: true` in config

### Events Not Appearing

- Check server connectivity: `curl http://localhost:8080/health`
- Enable debug logging to see event transmission
- Verify `client.Stop()` is called to flush events
- Check for errors in the Raceway server logs

## License

MIT

## Support

- **Example Code**: See `examples/go-banking` directory
- **Issues**: Report bugs and request features via GitHub issues
