# Go SDK

Official Go SDK for Raceway - Race condition detection and distributed tracing for Go applications.

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
    client := raceway.New(raceway.Config{
        ServerURL:   "http://localhost:8080",
        ServiceName: "my-service",
        InstanceID:  "instance-1",
    })
    defer client.Shutdown()

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
        client.TrackFunctionCall(ctx, "transfer", "app", map[string]interface{}{
            "from":   "alice",
            "to":     "bob",
            "amount": 100,
        }, "main.go", 56)

        // Track state changes
        balance := getBalance("alice")
        client.TrackStateChange(ctx, "alice.balance", nil, balance, "main.go:63", "Read")

        if balance < 100 {
            headers := map[string]string{}
            client.TrackHTTPResponse(ctx, 400, headers, nil, time.Since(startTime).Milliseconds())
            w.WriteHeader(http.StatusBadRequest)
            return
        }

        setBalance("alice", balance-100)
        client.TrackStateChange(ctx, "alice.balance", balance, balance-100, "main.go:72", "Write")

        headers := map[string]string{}
        client.TrackHTTPResponse(ctx, 200, headers, nil, time.Since(startTime).Milliseconds())
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

## Authentication

If your Raceway server is configured with API key authentication, provide the key when initializing the SDK:

```go
import (
    "os"
    raceway "github.com/mode7labs/raceway/sdks/go"
)

client := raceway.New(raceway.Config{
    ServerURL:   "http://localhost:8080",
    ServiceName: "my-service",
    APIKey:      os.Getenv("RACEWAY_API_KEY"),  // Read from environment variable
})
defer client.Shutdown()
```

**Best Practices:**
- Store API keys in environment variables, never hardcode them
- Use different keys for different environments (dev, staging, production)
- Rotate keys periodically for security
- The SDK will include the API key in the `Authorization` header: `Bearer <your-api-key>`

**Without Authentication:**

If your Raceway server doesn't require authentication, simply omit the `APIKey` parameter:

```go
client := raceway.New(raceway.Config{
    ServerURL:   "http://localhost:8080",
    ServiceName: "my-service",
})
```

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

#### `raceway.New(config)`

Create a new Raceway client instance.

```go
client := raceway.New(raceway.Config{
    ServerURL:   "http://localhost:8080",
    ServiceName: "my-service",
    InstanceID:  "instance-1",
})
defer client.Shutdown()
```

**Note:** `raceway.NewClient()` is available as an alias for compatibility.

### Core Tracking Methods

All methods accept `context.Context` as the first parameter for automatic goroutine tracking.

#### `client.TrackStateChange(ctx, variable, oldValue, newValue, location, accessType)`

Track a variable read or write.

```go
// Track a read
client.TrackStateChange(ctx, "counter", nil, 5, "main.go:42", "Read")

// Track a write
client.TrackStateChange(ctx, "counter", 5, 6, "main.go:45", "Write")
```

#### `client.TrackFunctionCall(ctx, functionName, module, args, file, line)`

Track a function call (no duration tracking).

```go
client.TrackFunctionCall(ctx, "processPayment", "app", map[string]interface{}{
    "userId": 123,
    "amount": 50,
}, "main.go", 42)
```

#### `client.TrackFunction(ctx, functionName, args, fn) interface{}`

Track a function with automatic duration measurement by wrapping it.

```go
result := client.TrackFunction(ctx, "processPayment", map[string]interface{}{
    "userId": 123,
    "amount": 50,
}, func() interface{} {
    // Your function logic here
    return processPaymentLogic()
})
```

#### `client.StartFunction(ctx, functionName, args) func()`

Track a function with automatic duration measurement. Returns a function to be called with `defer`. This is the idiomatic Go pattern.

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

#### `client.TrackFunctionReturn(ctx, functionName, returnValue, file, line)`

Track a function return with its return value.

```go
client.TrackFunctionReturn(ctx, "processPayment", result, "main.go", 50)
```

#### `client.TrackHTTPRequest(ctx, method, url, headers, body)`

Track an HTTP request. This is automatically called by the middleware.

```go
headers := map[string]string{"Content-Type": "application/json"}
client.TrackHTTPRequest(ctx, "POST", "/api/users", headers, nil)
```

#### `client.TrackHTTPResponse(ctx, status, headers, body, durationMs)`

Track an HTTP response.

```go
headers := map[string]string{"Content-Type": "application/json"}
durationMs := time.Since(startTime).Milliseconds()
client.TrackHTTPResponse(ctx, 200, headers, nil, durationMs)
```

### Async Tracking Methods

#### `client.TrackAsyncSpawn(ctx, taskID, taskName, location)`

Track spawning a goroutine.

```go
taskID := uuid.New().String()
client.TrackAsyncSpawn(ctx, taskID, "backgroundProcessor", "main.go:85")

go func() {
    // Task logic here
}()
```

#### `client.TrackAsyncAwait(ctx, futureID, location)`

Track waiting for an async operation.

```go
client.TrackAsyncAwait(ctx, futureID, "main.go:90")
result := <-resultChan
```

### Lock Tracking Methods

The Go SDK provides both manual lock tracking methods and convenience helpers for automatic tracking.

#### `client.TrackLockAcquire(ctx, lockID, lockType)`

Manually track lock acquisition. Location is automatically captured.

```go
client.TrackLockAcquire(ctx, "account_lock", "Mutex")
accountLock.Lock()
```

#### `client.TrackLockRelease(ctx, lockID, lockType)`

Manually track lock release. Location is automatically captured.

```go
accountLock.Unlock()
client.TrackLockRelease(ctx, "account_lock", "Mutex")
```

#### `client.WithLock(ctx, lock, lockID, lockType, fn)`

Execute a function while holding a lock, automatically tracking acquire and release.

```go
var accountLock sync.Mutex

client.WithLock(ctx, &accountLock, "account_lock", "Mutex", func() {
    accounts["alice"].Balance -= 100
})
// Lock is automatically acquired before fn() and released after, even if panic occurs
```

**Benefits:**
- Automatic acquire/release tracking
- Exception-safe (lock released even if panic occurs)
- Works with `sync.Mutex` or any type implementing `sync.Locker`

#### `client.WithRWLockRead(ctx, lock, lockID, fn)`

Execute a function while holding a read lock.

```go
var dataLock sync.RWMutex

client.WithRWLockRead(ctx, &dataLock, "data_lock", func() {
    balance := accounts["alice"].Balance
    fmt.Println(balance)
})
```

#### `client.WithRWLockWrite(ctx, lock, lockID, fn)`

Execute a function while holding a write lock.

```go
var dataLock sync.RWMutex

client.WithRWLockWrite(ctx, &dataLock, "data_lock", func() {
    accounts["alice"].Balance -= 100
})
```

### Error Tracking Methods

#### `client.TrackError(ctx, errorType, message, stackTrace)`

Track an error occurrence.

```go
stackTrace := []string{"main.go:42", "handler.go:15"}
client.TrackError(ctx, "ValidationError", "Invalid amount", stackTrace)
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

#### `client.Flush()`

Manually flush buffered events to the server.

```go
client.Flush()
```

Use this when you need to ensure events are sent immediately (e.g., before process exit, after critical operations).

#### `client.Shutdown()`

Flush remaining events and stop the auto-flush goroutine.

```go
defer client.Shutdown()
```

**Note:** `Shutdown()` calls `Flush()` internally before stopping background tasks.

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
    client.TrackFunctionCall(ctx, "processOrder", "app", nil, "main.go", 514)
    // Context automatically carries trace information
}
```

## Best Practices

1. **Always pass context**: Ensure `context.Context` flows through your entire call chain
2. **Use middleware**: Set up Raceway middleware for automatic initialization
3. **Track shared state**: Focus on shared mutable state accessed by multiple goroutines
4. **Propagate headers**: Always use `PropagationHeaders()` when calling downstream services
5. **Graceful shutdown**: Always call `client.Shutdown()` before exiting:
   ```go
   defer client.Shutdown()
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
    client := raceway.New(raceway.Config{
        ServerURL:   "http://localhost:8080",
        ServiceName: "api-gateway",
        InstanceID:  "gateway-1",
    })
    defer client.Shutdown()

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

        client.TrackFunctionCall(ctx, "createOrder", "app", map[string]interface{}{
            "orderId": req.OrderID,
        }, "main.go", 567)

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
3. Verify `client.Shutdown()` is called to flush events
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

## Next Steps

- [TypeScript SDK](/sdks/typescript) - Node.js integration
- [Python SDK](/sdks/python) - Python integration
- [Rust SDK](/sdks/rust) - Rust integration
- [Security](/guide/security) - Best practices
- [Distributed Tracing](/guide/distributed-tracing) - Cross-service tracing
