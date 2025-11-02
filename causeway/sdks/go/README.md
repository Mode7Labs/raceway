# raceway-go

Official Go SDK for [Raceway](https://github.com/mode7labs/raceway) - Race condition detection and distributed tracing for Go applications.

📚 **[Full Documentation](https://mode7labs.github.io/raceway/sdks/go)**

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
            "from": "alice", "to": "bob", "amount": 100,
        })

        // Track state changes
        balance := getBalance("alice")
        client.TrackStateChange(ctx, "alice.balance", nil, balance, "Read")

        setBalance("alice", balance-100)
        client.TrackStateChange(ctx, "alice.balance", balance, balance-100, "Write")

        client.TrackHTTPResponse(ctx, 200, uint64(time.Since(startTime).Milliseconds()))
        w.WriteHeader(http.StatusOK)
    }
}
```

## Distributed Tracing

Propagate traces across service boundaries:

```go
import (
    "net/http"
    "bytes"
    "encoding/json"
)

func checkoutHandler(client *raceway.Client) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()

        // Get propagation headers
        headers, err := client.PropagationHeaders(ctx, nil)
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }

        // Call downstream service
        req, _ := http.NewRequestWithContext(ctx, "POST",
            "http://inventory-service/reserve", body)
        for k, v := range headers {
            req.Header.Set(k, v)
        }
        http.DefaultClient.Do(req)

        w.WriteHeader(http.StatusOK)
    }
}
```

## Documentation

- 📚 **[Full SDK Documentation](https://mode7labs.github.io/raceway/sdks/go)** - Complete API reference and examples
- 🚀 **[Getting Started Guide](https://mode7labs.github.io/raceway/guide/getting-started)** - Step-by-step setup
- 🔍 **[Race Detection Guide](https://mode7labs.github.io/raceway/guide/race-detection)** - Understanding race conditions
- 🌐 **[Distributed Tracing](https://mode7labs.github.io/raceway/guide/distributed-tracing)** - Cross-service tracing
- 🔐 **[Security Guide](https://mode7labs.github.io/raceway/guide/security)** - Best practices

## Examples

See [examples/go-banking](../../examples/go-banking) for a complete Go application with Raceway integration.

## License

MIT

## Links

- [GitHub Repository](https://github.com/mode7labs/raceway)
- [Documentation](https://mode7labs.github.io/raceway)
- [Issue Tracker](https://github.com/mode7labs/raceway/issues)
