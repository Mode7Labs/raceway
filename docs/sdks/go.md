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
    "encoding/json"
    "net/http"
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

    // Health check - not traced
    mux.HandleFunc("/health", healthHandler)

    // Business endpoint - traced
    mux.HandleFunc("/api/transfer", traced(client, transferHandler(client)))

    http.ListenAndServe(":3000", mux)
}

// Helper to apply middleware to specific routes
func traced(client *raceway.Client, handler http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        client.Middleware(http.HandlerFunc(handler)).ServeHTTP(w, r)
    }
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func transferHandler(client *raceway.Client) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()

        var req TransferRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            client.TrackError(ctx, "ParseError", err.Error(), nil)
            http.Error(w, "Invalid request", http.StatusBadRequest)
            return
        }

        // Track critical state read
        balance := getBalance(req.From)
        client.TrackStateChange(ctx, "accounts."+req.From+".balance", nil, balance, "", "Read")

        if balance < req.Amount {
            client.TrackError(ctx, "InsufficientFunds", "Balance too low", nil)
            http.Error(w, "Insufficient funds", http.StatusBadRequest)
            return
        }

        // Update balances
        newBalance := balance - req.Amount
        setBalance(req.From, newBalance)
        client.TrackStateChange(ctx, "accounts."+req.From+".balance", balance, newBalance, "", "Write")

        w.WriteHeader(http.StatusOK)
        json.NewEncoder(w).Encode(map[string]interface{}{
            "success": true,
            "newBalance": newBalance,
        })
    }
}
```

## Middleware Patterns

The SDK middleware can be applied globally or per-route. Choose the pattern that best fits your environment.

### Global Middleware (Development/Quick Start)

```go
mux := http.NewServeMux()
mux.HandleFunc("/api/transfer", transferHandler(client))

// Apply to ALL routes
handler := client.Middleware(mux)
http.ListenAndServe(":3000", handler)
```

Traces all routes. Good for development and getting started quickly.

### Per-Route Middleware (Production Recommended)

```go
mux := http.NewServeMux()

// Health checks and metrics - no tracing
mux.HandleFunc("/health", healthHandler)
mux.HandleFunc("/metrics", metricsHandler)

// Business endpoints - traced
mux.HandleFunc("/api/transfer", traced(client, transferHandler(client)))
mux.HandleFunc("/api/users/", traced(client, getUserHandler(client)))
mux.HandleFunc("/api/checkout", traced(client, checkoutHandler(client)))

// Use unwrapped mux
http.ListenAndServe(":3000", mux)

// Helper function
func traced(client *raceway.Client, handler http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        client.Middleware(http.HandlerFunc(handler)).ServeHTTP(w, r)
    }
}
```

**Why per-route is better for production:**

- **No health check noise**: Load balancers polling `/health` every 10 seconds create 8,640 traces per day per instance
- **Excludes non-business endpoints**: Metrics, static assets, and internal endpoints don't pollute your analysis
- **Better signal-to-noise ratio**: Only trace what matters for debugging and analysis
- **Lower database load**: Fewer events = faster ingestion, less storage, better query performance
- **Blocks bot traffic**: Bots probing `/phpmyadmin`, `/.env`, etc. won't create traces

**Example: Health check impact**

If you have 5 service instances with load balancers checking health every 10 seconds:
- Global middleware: **43,200 health check traces per day**
- Per-route middleware: **0 health check traces**

### Conditional Middleware (Alternative Pattern)

If you prefer a filter approach:

```go
func selectiveMiddleware(client *raceway.Client, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Skip tracing for certain paths
        if r.URL.Path == "/health" ||
           r.URL.Path == "/metrics" ||
           strings.HasPrefix(r.URL.Path, "/static/") {
            next.ServeHTTP(w, r)
            return
        }

        // Skip bot traffic
        userAgent := r.Header.Get("User-Agent")
        if strings.Contains(strings.ToLower(userAgent), "bot") {
            next.ServeHTTP(w, r)
            return
        }

        // Trace everything else
        client.Middleware(next).ServeHTTP(w, r)
    })
}

// Usage
handler := selectiveMiddleware(client, mux)
http.ListenAndServe(":3000", handler)
```

### When to Use Each Pattern

| Pattern | Use When | Trade-offs |
|---------|----------|-----------|
| **Global** | Development, early prototyping | Simple setup, but creates noise from health checks |
| **Per-Route** | Production, mature applications | Requires discipline, but much cleaner traces |
| **Conditional** | Complex routing rules | Flexible, but filter logic can get complex |

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

## What to Track

**Raceway is not a profiler** - it's designed to detect race conditions and understand event ordering. You don't need to track every function call or variable access.

### Track This ✅

| What | Why | Example |
|------|-----|---------|
| **Errors** | Essential for debugging | `client.TrackError(ctx, "DBError", err.Error(), nil)` |
| **Critical state changes** | Shared state accessed by multiple goroutines | `client.TrackStateChange(ctx, "accounts.alice.balance", 100, 50, "", "Write")` |
| **Queue operations** | Enqueue/dequeue from channels or message queues | `client.TrackStateChange(ctx, "queue.dequeued", nil, msg.ID, "", "Read")` |
| **Lock acquire/release** | Use helpers: `WithLock()`, `WithRWLockRead()`, `WithRWLockWrite()` | `client.WithLock(ctx, &mu, "account_lock", "Mutex", func() {...})` |

### Don't Track This ❌

| What | Why |
|------|-----|
| **Every function call** | Creates massive noise, no value for race detection |
| **HTTP requests/responses** | Middleware handles this automatically |
| **Local variables** | Not shared across goroutines |
| **Database queries** | Implementation detail, adds overhead |
| **Validation logic** | Not relevant to concurrency |

### Approach Comparison

#### ❌ Over-Instrumented (Avoid)

```go
func transfer(ctx context.Context, client *raceway.Client, from, to string, amount int) error {
    // Too much noise!
    client.TrackFunctionCall(ctx, "transfer", "app", map[string]interface{}{
        "from": from, "to": to, "amount": amount,
    }, "transfer.go", 42)

    client.TrackFunctionCall(ctx, "validateAmount", "app", nil, "transfer.go", 47)
    if err := validateAmount(amount); err != nil {
        client.TrackFunctionReturn(ctx, "validateAmount", err, "transfer.go", 50)
        client.TrackError(ctx, "ValidationError", err.Error(), nil)
        return err
    }
    client.TrackFunctionReturn(ctx, "validateAmount", nil, "transfer.go", 54)

    balance := getBalance(from)
    client.TrackStateChange(ctx, from+".balance", nil, balance, "transfer.go:58", "Read")

    client.TrackFunctionCall(ctx, "checkSufficientFunds", "app", nil, "transfer.go", 60)
    if balance < amount {
        client.TrackError(ctx, "InsufficientFunds", "Not enough balance", nil)
        return errors.New("insufficient funds")
    }

    newBalance := balance - amount
    setBalance(from, newBalance)
    client.TrackStateChange(ctx, from+".balance", balance, newBalance, "transfer.go:69", "Write")

    client.TrackFunctionReturn(ctx, "transfer", nil, "transfer.go", 71)
    return nil
}
```

**Problems:**
- 8+ tracking calls for simple function
- Tracking validation (not relevant to races)
- Tracking function returns (adds no value)
- Database queries tracked (implementation detail)

#### ✅ Well-Instrumented (Recommended)

```go
func transfer(ctx context.Context, client *raceway.Client, from, to string, amount int) error {
    // Only track what matters!

    if err := validateAmount(amount); err != nil {
        client.TrackError(ctx, "ValidationError", err.Error(), nil)
        return err
    }

    // Track critical shared state read
    balance := getBalance(from)
    client.TrackStateChange(ctx, "accounts."+from+".balance", nil, balance, "", "Read")

    if balance < amount {
        client.TrackError(ctx, "InsufficientFunds", "Not enough balance", nil)
        return errors.New("insufficient funds")
    }

    // Track critical shared state write
    newBalance := balance - amount
    setBalance(from, newBalance)
    client.TrackStateChange(ctx, "accounts."+from+".balance", balance, newBalance, "", "Write")

    return nil
}
```

**Benefits:**
- 2-3 tracking calls (vs 8+)
- Only tracks shared mutable state
- Errors tracked for debugging
- No noise from validation or implementation details

#### 🏆 Minimalist (Production)

For production with high traffic, track even less:

```go
func transfer(ctx context.Context, client *raceway.Client, from, to string, amount int) error {
    // Only track errors - middleware handles requests

    if err := validateAmount(amount); err != nil {
        client.TrackError(ctx, "ValidationError", err.Error(), nil)
        return err
    }

    balance := getBalance(from)

    if balance < amount {
        client.TrackError(ctx, "InsufficientFunds", "Not enough balance", nil)
        return errors.New("insufficient funds")
    }

    // Critical: Use lock helpers to automatically track acquire/release
    err := client.WithLock(ctx, &accountLock, "account_lock", "Mutex", func() {
        setBalance(from, balance - amount)
    })

    return err
}
```

**When to use:**
- High-volume production services
- After race conditions are understood and fixed
- When you need minimal overhead

### Quick Decision Tree

```
Do I need to track this?
│
├─ Is it an error?                    → ✅ YES: TrackError
├─ Is it shared state?                → Maybe:
│  ├─ Multiple goroutines access it? → ✅ YES: TrackStateChange
│  └─ Only one goroutine?            → ❌ NO
├─ Is it a lock?                      → ✅ YES: Use WithLock helpers
├─ HTTP request/response?             → ❌ NO: Middleware handles it
├─ Function call?                     → ❌ NO: Creates noise
└─ Everything else?                   → ❌ NO: Skip it
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

### Choosing a Function Tracking Method

The SDK provides multiple ways to track functions. Here's when to use each:

| Method | When to Use | Pros | Cons |
|--------|-------------|------|------|
| **`TrackFunctionCall`** | Action/event without duration | Simple, lightweight | No duration tracking |
| **`StartFunction` (defer)** | Track duration automatically | Idiomatic Go, panic-safe | Requires defer |
| **`TrackFunction` (wrapper)** | Wrap short functions | Auto duration + return value | Wrapper overhead |
| **`TrackFunctionReturn`** | Manual tracking | Full control | Error-prone, forget to call |

**Recommended approach:**

```go
// ✅ BEST: Use StartFunction with defer for automatic duration
func processPayment(ctx context.Context, client *raceway.Client) error {
    defer client.StartFunction(ctx, "processPayment", map[string]interface{}{
        "amount": 100,
    })()

    // Function logic here
    return nil
}
```

**When NOT to track functions:**

Most of the time, you shouldn't track functions at all! See the [What to Track](#what-to-track) section for guidance.

- ❌ Don't track every function (creates noise)
- ❌ Don't track validation functions (not relevant to races)
- ❌ Don't track database helper functions (implementation detail)
- ✅ Only track when you need to understand event ordering for race detection

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

## Working with Background Goroutines

**Critical**: HTTP request contexts are canceled when the HTTP response is sent. If you start a background goroutine that outlives the request, you must detach the context while preserving trace information.

### The Problem

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    // Insert job into database
    jobID := insertJob(ctx, payload)

    // Return immediately
    w.WriteHeader(http.StatusAccepted)
    json.NewEncoder(w).Encode(map[string]string{"jobID": jobID})

    // ❌ WRONG: Context will be canceled after response is sent
    go processJob(ctx, jobID)
    // All events in processJob will be lost or go to orphaned trace!
}
```

**What happens:**
1. Response is sent to client
2. HTTP server cancels `r.Context()`
3. Background goroutine's context is canceled
4. All Raceway tracking events are lost or create orphaned traces

### Solution 1: context.WithoutCancel (Go 1.21+)

The recommended approach for Go 1.21 and later:

```go
import "context"

func handler(w http.ResponseWriter, r *http.Request) {
    requestCtx := r.Context()

    // Detach context but preserve trace info
    backgroundCtx := context.WithoutCancel(requestCtx)

    jobID := insertJob(requestCtx, payload)

    w.WriteHeader(http.StatusAccepted)
    json.NewEncoder(w).Encode(map[string]string{"jobID": jobID})

    // ✅ CORRECT: Background goroutine has independent context with same trace
    go processJob(backgroundCtx, jobID)
}

func processJob(ctx context.Context, jobID string) {
    // All tracking events will be in the same trace!
    client.TrackStateChange(ctx, "job."+jobID+".status", "pending", "processing", "", "Write")

    // ... process job ...

    client.TrackStateChange(ctx, "job."+jobID+".status", "processing", "completed", "", "Write")
}
```

### Solution 2: Extract and Recreate Context (Go < 1.21)

For older Go versions, manually extract and recreate the trace context:

```go
import (
    "context"
    raceway "github.com/mode7labs/raceway/sdks/go"
)

func handler(w http.ResponseWriter, r *http.Request) {
    requestCtx := r.Context()

    // Extract Raceway context
    raceCtx := raceway.GetRacewayContext(requestCtx)
    if raceCtx == nil {
        http.Error(w, "No trace context", http.StatusInternalServerError)
        return
    }

    jobID := insertJob(requestCtx, payload)

    w.WriteHeader(http.StatusAccepted)
    json.NewEncoder(w).Encode(map[string]string{"jobID": jobID})

    // Recreate context with same trace info
    backgroundCtx := raceway.WithRacewayContext(context.Background(), raceCtx)

    // ✅ CORRECT: Same trace, independent lifecycle
    go processJob(backgroundCtx, jobID)
}
```

### Solution 3: Channel-Based Context Propagation

For message queues or worker pools, pass context through channels:

```go
type messageWithContext struct {
    ctx context.Context
    msg Message
}

var jobQueue = make(chan messageWithContext, 100)

func handler(w http.ResponseWriter, r *http.Request) {
    requestCtx := r.Context()

    var msg Message
    json.NewDecoder(r.Body).Decode(&msg)

    // Detach context
    backgroundCtx := context.WithoutCancel(requestCtx)

    // Send context with message
    jobQueue <- messageWithContext{
        ctx: backgroundCtx,
        msg: msg,
    }

    w.WriteHeader(http.StatusAccepted)
}

func worker() {
    for msgWithCtx := range jobQueue {
        ctx := msgWithCtx.ctx  // Use context from HTTP request
        msg := msgWithCtx.msg

        // All events in same trace!
        client.TrackStateChange(ctx, "queue.dequeued", nil, msg.ID, "", "Read")
        processMessage(ctx, msg)
    }
}
```

### Common Mistakes

| Mistake | Result | Fix |
|---------|--------|-----|
| `go task(r.Context())` | Events lost after response | Use `context.WithoutCancel()` |
| `go task(context.Background())` | Creates new trace | Extract and recreate with same trace ID |
| Not passing context at all | No tracing in background tasks | Always propagate detached context |

### When to Detach Context

Detach context when:
- Starting goroutines that outlive HTTP request
- Enqueueing jobs to message queues
- Scheduling background tasks
- Spawning workers that process after response

Don't detach when:
- Calling downstream services during request (use `r.Context()` directly)
- Synchronous processing within request lifecycle
- Short-lived goroutines that complete before response

## Best Practices

### Production Deployment

1. **Use per-route middleware**: Apply `traced()` helper to business endpoints only, excluding health checks, metrics, and static assets to avoid trace noise
   ```go
   mux.HandleFunc("/health", healthHandler)  // Not traced
   mux.HandleFunc("/api/transfer", traced(client, transferHandler(client)))  // Traced
   ```

2. **Detach context for background goroutines**: Always use `context.WithoutCancel()` when spawning goroutines that outlive the HTTP request
   ```go
   backgroundCtx := context.WithoutCancel(r.Context())
   go processJob(backgroundCtx, jobID)
   ```

3. **Track minimally**: Only track errors and critical shared state. Avoid tracking every function call or local variable
   ```go
   // ✅ Good: Only errors and critical state
   client.TrackError(ctx, "DBError", err.Error(), nil)
   client.TrackStateChange(ctx, "accounts.alice.balance", 100, 50, "", "Write")

   // ❌ Bad: Over-instrumentation
   client.TrackFunctionCall(ctx, "validateInput", ...)
   client.TrackFunctionReturn(ctx, "getUser", ...)
   ```

4. **Use lock helpers**: Prefer `WithLock()` over manual `TrackLockAcquire/Release` for automatic tracking and panic safety
   ```go
   client.WithLock(ctx, &accountLock, "account_lock", "Mutex", func() {
       accounts["alice"] -= 100
   })
   ```

5. **Propagate headers to downstream services**: Always use `PropagationHeaders()` when calling other services to maintain distributed traces
   ```go
   headers, _ := client.PropagationHeaders(ctx, nil)
   req.Header.Set("traceparent", headers["traceparent"])
   req.Header.Set("raceway-clock", headers["raceway-clock"])
   ```

6. **Graceful shutdown**: Always call `client.Shutdown()` before process exit to flush remaining events
   ```go
   func main() {
       client := raceway.New(config)
       defer client.Shutdown()

       // ... application code ...
   }
   ```

7. **Use unique instance IDs**: Set `InstanceID` to differentiate service instances in distributed environments
   ```go
   client := raceway.New(raceway.Config{
       InstanceID: hostname + "-" + strconv.Itoa(os.Getpid()),
   })
   ```

### Development Workflow

1. **Start with global middleware during development**: Use `client.Middleware(mux)` for quick setup, then switch to per-route for production

2. **Enable debug mode for troubleshooting**: Set `Debug: true` in config to see event submission details

3. **Verify trace continuity**: Check that background goroutine events appear in the same trace as the originating HTTP request

### Common Pitfalls

| Mistake | Impact | Fix |
|---------|--------|-----|
| Using `r.Context()` in background goroutine | Events lost after response | Use `context.WithoutCancel(r.Context())` |
| Global middleware in production | Health check noise | Use per-route middleware |
| Tracking every function | Massive noise, slow ingestion | Only track errors + critical state |
| Forgetting `client.Shutdown()` | Events not flushed | Always `defer client.Shutdown()` |
| Manual lock tracking | Forget to release, no panic safety | Use `WithLock()` helpers |

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

### Only HTTP request event appears, background events missing

**Symptom**: Trace shows only the HTTP request event, but no events from background goroutines or async processing.

**Cause**: Context was canceled after HTTP response was sent, or background goroutine used `context.Background()`.

**Fix**: Use `context.WithoutCancel()` to detach context while preserving trace info:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    requestCtx := r.Context()

    // ✅ Detach context for background work
    backgroundCtx := context.WithoutCancel(requestCtx)

    w.WriteHeader(http.StatusAccepted)

    // Events will appear in same trace
    go processJob(backgroundCtx, jobID)
}
```

See [Working with Background Goroutines](#working-with-background-goroutines) for complete details.

### Events not appearing

1. Check server is running: `curl http://localhost:8080/health`
2. Enable debug mode: `Config{Debug: true}`
3. Verify `client.Shutdown()` is called to flush events
4. Check middleware is properly installed
5. Verify context is being propagated (not using `context.Background()`)

### Distributed traces not merging

1. Ensure all services use `PropagationHeaders()` when calling downstream
2. Verify `traceparent` header is being sent (enable debug mode)
3. Check that all services report to the same Raceway server
4. Verify instance IDs are unique per service instance

### Context not available errors

- Ensure middleware is set up on your HTTP handler
- Always pass `context.Context` through function calls
- Verify `PropagationHeaders()` is called within a request context
- Don't use `context.Background()` - extract and recreate with trace info instead

### Too many traces from health checks or bots

**Symptom**: Database filling up with health check traces, bot traffic appearing in Raceway.

**Fix**: Use per-route middleware instead of global:

```go
mux := http.NewServeMux()

// NOT traced
mux.HandleFunc("/health", healthHandler)

// Traced
mux.HandleFunc("/api/transfer", traced(client, transferHandler(client)))
```

See [Middleware Patterns](#middleware-patterns) for details.

## Next Steps

- [TypeScript SDK](/sdks/typescript) - Node.js integration
- [Python SDK](/sdks/python) - Python integration
- [Rust SDK](/sdks/rust) - Rust integration
- [Security](/guide/security) - Best practices
- [Distributed Tracing](/guide/distributed-tracing) - Cross-service tracing
