# raceway-go

Official Go SDK for [Raceway](https://github.com/mode7labs/raceway) - Race condition detection and distributed tracing for Go applications.

## Features

- Idiomatic Go API using `context.Context`
- Automatic goroutine tracking
- HTTP middleware for automatic trace initialization
- Distributed tracing across service boundaries (W3C Trace Context)
- Race condition and concurrency bug detection
- Production-ready with automatic batching and background flushing

## Installation

```bash
go get github.com/mode7labs/raceway/sdks/go
```

## Quick Start

### Basic HTTP Server

```go
package main

import (
    "net/http"
    "time"
    raceway "github.com/mode7labs/raceway/sdks/go"
)

func main() {
    client := raceway.NewClient(raceway.Config{
        ServerURL:   "http://localhost:8080",
        ServiceName: "my-service",
        InstanceID:  "instance-1",
    })
    defer client.Stop()

    mux := http.NewServeMux()
    mux.HandleFunc("/api/transfer", transferHandler(client))

    // Wrap with Raceway middleware
    handler := client.Middleware(mux)

    http.ListenAndServe(":3000", handler)
}

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

        // Track state changes
        balance := getBalance("alice")
        client.TrackStateChange(ctx, "alice.balance", nil, balance, "Read")

        if balance < 100 {
            client.TrackHTTPResponse(ctx, 400, uint64(time.Since(startTime).Milliseconds()))
            w.WriteHeader(http.StatusBadRequest)
            return
        }

        setBalance("alice", balance-100)
        client.TrackStateChange(ctx, "alice.balance", balance, balance-100, "Write")

        client.TrackHTTPResponse(ctx, 200, uint64(time.Since(startTime).Milliseconds()))
        w.WriteHeader(http.StatusOK)
    }
}
```

## Distributed Tracing

The SDK implements W3C Trace Context and Raceway vector clocks for distributed tracing across services.

### Propagating Trace Context

Use `PropagationHeaders()` when calling downstream services:

```go
import (
    "net/http"
    "bytes"
    "encoding/json"
    raceway "github.com/mode7labs/raceway/sdks/go"
)

func checkoutHandler(client *raceway.Client) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()

        var req CheckoutRequest
        json.NewDecoder(r.Body).Decode(&req)

        // Get propagation headers
        headers, err := client.PropagationHeaders(ctx, nil)
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }

        // Call inventory service
        inventoryData, _ := json.Marshal(map[string]interface{}{"orderId": req.OrderID})
        inventoryReq, _ := http.NewRequestWithContext(ctx, "POST",
            "http://inventory-service/reserve",
            bytes.NewReader(inventoryData))

        for k, v := range headers {
            inventoryReq.Header.Set(k, v)
        }
        http.DefaultClient.Do(inventoryReq)

        // Call payment service
        paymentData, _ := json.Marshal(map[string]interface{}{"orderId": req.OrderID})
        paymentReq, _ := http.NewRequestWithContext(ctx, "POST",
            "http://payment-service/charge",
            bytes.NewReader(paymentData))

        for k, v := range headers {
            paymentReq.Header.Set(k, v)
        }
        http.DefaultClient.Do(paymentReq)

        w.WriteHeader(http.StatusOK)
    }
}
```

### What Gets Propagated

The middleware automatically:
- Parses incoming `traceparent`, `tracestate`, and `raceway-clock` headers
- Generates new span IDs for this service
- Returns headers for downstream calls via `PropagationHeaders()`

Headers propagated:
- `traceparent`: W3C Trace Context (trace ID, span ID, trace flags)
- `tracestate`: W3C vendor-specific state
- `raceway-clock`: Raceway vector clock for causality tracking

### Cross-Service Trace Merging

Events from all services sharing the same trace ID are automatically merged by the Raceway backend. The backend recursively follows distributed edges to construct complete traces across arbitrary service chain lengths.

## Configuration

```go
type Config struct {
    ServerURL     string            // Raceway server URL (required)
    ServiceName   string            // Service name (default: "unknown-service")
    InstanceID    string            // Instance ID (default: hostname-PID)
    Environment   string            // Environment (default: "development")
    BatchSize     int               // Batch size (default: 100)
    FlushInterval time.Duration     // Flush interval (default: 1 second)
    Tags          map[string]string // Custom tags
    Debug         bool              // Debug mode (default: false)
}
```

## API Reference

### Client Creation

#### `raceway.NewClient(config)`

Create a new Raceway client instance.

```go
client := raceway.NewClient(raceway.Config{
    ServerURL:   "http://localhost:8080",
    ServiceName: "my-service",
    InstanceID:  "instance-1",
})
defer client.Stop()
```

### Core Tracking Methods

All methods accept `context.Context` as the first parameter for automatic goroutine tracking.

#### `client.TrackStateChange(ctx, variable, oldValue, newValue, accessType)`

Track a variable read or write.

```go
// Track a read
client.TrackStateChange(ctx, "counter", nil, 5, "Read")

// Track a write
client.TrackStateChange(ctx, "counter", 5, 6, "Write")
```

#### `client.TrackFunctionCall(ctx, functionName, args)`

Track a function call (no duration tracking).

```go
client.TrackFunctionCall(ctx, "processPayment", map[string]interface{}{
    "userId": 123,
    "amount": 50,
})
```

#### `client.StartFunction(ctx, functionName, args) func()`

Track a function with automatic duration measurement. Returns a function to be called with `defer`.

```go
func transfer(ctx context.Context, client *raceway.Client) {
    defer client.StartFunction(ctx, "transfer", map[string]interface{}{
        "from":   "alice",
        "to":     "bob",
        "amount": 100,
    })()

    // Your function logic here
}
```

#### `client.TrackHTTPResponse(ctx, status, durationMs)`

Track an HTTP response.

```go
duration := uint64(time.Since(startTime).Milliseconds())
client.TrackHTTPResponse(ctx, 200, duration)
```

### Distributed Tracing Methods

#### `client.PropagationHeaders(ctx, extraHeaders) (map[string]string, error)`

Generate headers for downstream service calls.

```go
headers, err := client.PropagationHeaders(ctx, map[string]string{
    "X-Custom": "value",
})
if err != nil {
    return err
}

req, _ := http.NewRequestWithContext(ctx, "POST", downstreamURL, body)
for key, value := range headers {
    req.Header.Set(key, value)
}
http.DefaultClient.Do(req)
```

**Returns:** Map with `traceparent`, `tracestate`, and `raceway-clock` headers.

**Error:** Returns error if called outside request context.

#### `client.Middleware(next http.Handler) http.Handler`

HTTP middleware for automatic trace initialization.

```go
mux := http.NewServeMux()
mux.HandleFunc("/api/endpoint", handler)

// Apply Raceway middleware
handler := client.Middleware(mux)
http.ListenAndServe(":3000", handler)
```

### Context Management

#### `raceway.NewRacewayContext(traceID) *RacewayContext`

Create a new Raceway context. Automatically generates a unique goroutine ID.

```go
raceCtx := raceway.NewRacewayContext(traceID)
```

#### `raceway.WithRacewayContext(ctx, raceCtx) context.Context`

Add Raceway context to a standard Go context.

```go
ctx := raceway.WithRacewayContext(r.Context(), raceCtx)
```

#### `raceway.GetRacewayContext(ctx) *RacewayContext`

Extract Raceway context from a Go context.

```go
raceCtx := raceway.GetRacewayContext(ctx)
```

### Lifecycle Methods

#### `client.Stop()`

Stop the client and flush remaining events.

```go
defer client.Stop()
```

## Goroutine Tracking

The SDK automatically assigns a unique identifier to each goroutine:

1. When `NewRacewayContext()` is called, the SDK generates a unique goroutine ID: `go-<pid>-<counter>`
2. This ID is stored in the `RacewayContext` and propagated via `context.Context`
3. Raceway uses these IDs to detect concurrent access from different goroutines

No manual goroutine ID management required.

## Context Propagation

Always pass `context.Context` through your call chain:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()  // Get context from request
    processOrder(ctx)   // Pass to downstream functions
}

func processOrder(ctx context.Context) {
    client.TrackFunctionCall(ctx, "processOrder", nil)
    // Context automatically carries trace information
}
```

## Best Practices

1. **Always pass context**: Ensure `context.Context` flows through your entire call chain
2. **Use middleware**: Set up Raceway middleware for automatic initialization
3. **Track shared state**: Focus on shared mutable state accessed by multiple goroutines
4. **Propagate headers**: Always use `PropagationHeaders()` when calling downstream services
5. **Graceful shutdown**: Always call `client.Stop()` before exiting:
   ```go
   defer client.Stop()
   ```
6. **Use unique instance IDs**: Set `InstanceID` to differentiate service instances

## Distributed Example

Complete example with distributed tracing:

```go
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
    raceway "github.com/mode7labs/raceway/sdks/go"
)

func main() {
    client := raceway.NewClient(raceway.Config{
        ServerURL:   "http://localhost:8080",
        ServiceName: "api-gateway",
        InstanceID:  "gateway-1",
    })
    defer client.Stop()

    mux := http.NewServeMux()
    mux.HandleFunc("/api/order", createOrderHandler(client))

    handler := client.Middleware(mux)
    http.ListenAndServe(":3000", handler)
}

func createOrderHandler(client *raceway.Client) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()

        var req OrderRequest
        json.NewDecoder(r.Body).Decode(&req)

        client.TrackFunctionCall(ctx, "createOrder", map[string]interface{}{
            "orderId": req.OrderID,
        })

        // Get propagation headers
        headers, err := client.PropagationHeaders(ctx, nil)
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }

        // Call inventory service
        inventoryData, _ := json.Marshal(map[string]interface{}{"orderId": req.OrderID})
        inventoryReq, _ := http.NewRequestWithContext(ctx, "POST",
            "http://inventory-service:3001/reserve",
            bytes.NewReader(inventoryData))
        for k, v := range headers {
            inventoryReq.Header.Set(k, v)
        }
        http.DefaultClient.Do(inventoryReq)

        // Call payment service
        paymentData, _ := json.Marshal(map[string]interface{}{"orderId": req.OrderID})
        paymentReq, _ := http.NewRequestWithContext(ctx, "POST",
            "http://payment-service:3002/charge",
            bytes.NewReader(paymentData))
        for k, v := range headers {
            paymentReq.Header.Set(k, v)
        }
        http.DefaultClient.Do(paymentReq)

        w.WriteHeader(http.StatusOK)
        json.NewEncoder(w).Encode(map[string]interface{}{
            "success": true,
            "orderId": req.OrderID,
        })
    }
}
```

All services in the chain will share the same trace ID, and Raceway will merge their events into a single distributed trace.

## Troubleshooting

### Events not appearing

1. Check server is running: `curl http://localhost:8080/health`
2. Enable debug mode: `Config{Debug: true}`
3. Verify `client.Stop()` is called to flush events
4. Check middleware is properly installed

### Distributed traces not merging

1. Ensure all services use `PropagationHeaders()` when calling downstream
2. Verify `traceparent` header is being sent (enable debug mode)
3. Check that all services report to the same Raceway server
4. Verify instance IDs are unique per service instance

### Context not available errors

- Ensure middleware is set up on your HTTP handler
- Always pass `context.Context` through function calls
- Verify `PropagationHeaders()` is called within a request context

## License

MIT

## Links

- [GitHub Repository](https://github.com/mode7labs/raceway)
- [Documentation](https://docs.raceway.dev)
- [Issue Tracker](https://github.com/mode7labs/raceway/issues)
