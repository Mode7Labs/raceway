// Package raceway provides a lightweight SDK for race condition detection in Go applications.
package raceway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Config holds the configuration for the Raceway client.
type Config struct {
	// Endpoint is the Raceway server URL (default: http://localhost:8080)
	Endpoint string
	// ServiceName identifies this service in event metadata
	ServiceName string
	// Environment specifies the deployment environment (development, staging, production)
	Environment string
	// BatchSize is the number of events to buffer before sending (default: 50)
	BatchSize int
	// FlushInterval is how often to flush buffered events (default: 1 second)
	FlushInterval time.Duration
	// Debug enables debug logging
	Debug bool
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	env := os.Getenv("ENV")
	if env == "" {
		env = "development"
	}

	return Config{
		Endpoint:      "http://localhost:8080",
		ServiceName:   "unknown-service",
		Environment:   env,
		BatchSize:     50,
		FlushInterval: time.Second,
		Debug:         false,
	}
}

// Client is the main Raceway SDK client.
type Client struct {
	config      Config
	eventBuffer []Event
	mu          sync.Mutex
	httpClient  *http.Client
	flushTicker *time.Ticker
	stopChan    chan struct{}
}

// New creates a new Raceway client.
func New(config Config) *Client {
	client := &Client{
		config:      config,
		eventBuffer: make([]Event, 0, config.BatchSize),
		httpClient:  &http.Client{Timeout: 10 * time.Second},
		flushTicker: time.NewTicker(config.FlushInterval),
		stopChan:    make(chan struct{}),
	}

	// Start auto-flush goroutine
	go client.autoFlush()

	return client
}

// Middleware returns a Gin middleware handler that automatically initializes Raceway context.
// Usage: router.Use(raceway.Middleware())
func (c *Client) Middleware() func(ctx interface{}) {
	return func(ginCtx interface{}) {
		// Type assert to get the actual Gin context
		type ginContext interface {
			Request() *http.Request
			Next()
			Set(string, interface{})
		}

		// Extract trace ID from header or generate new one
		var traceID string
		if gc, ok := ginCtx.(interface{ Request() *http.Request }); ok {
			req := gc.Request()
			traceID = req.Header.Get("X-Trace-ID")
			if traceID == "" {
				traceID = uuid.New().String()
			}

			// Create Raceway context and attach to request context
			ctx := NewContext(req.Context(), traceID)

			// Track HTTP request as root event
			c.TrackHTTPRequest(ctx, req.Method, req.URL.Path, nil, nil)

			// Update request with new context
			*req = *req.WithContext(ctx)
		}

		// Call next handler
		if gc, ok := ginCtx.(interface{ Next() }); ok {
			gc.Next()
		}
	}
}

// TrackStateChange tracks a read or write to a variable.
func (c *Client) TrackStateChange(ctx context.Context, variable string, oldValue, newValue interface{}, location, accessType string) {
	c.captureEvent(ctx, EventKind{
		StateChange: &StateChangeData{
			Variable:   variable,
			OldValue:   oldValue,
			NewValue:   newValue,
			Location:   location,
			AccessType: accessType,
		},
	})
}

// TrackFunctionCall tracks a function entry.
func (c *Client) TrackFunctionCall(ctx context.Context, functionName, module string, args interface{}, file string, line int) {
	c.captureEvent(ctx, EventKind{
		FunctionCall: &FunctionCallData{
			FunctionName: functionName,
			Module:       module,
			Args:         args,
			File:         file,
			Line:         line,
		},
	})
}

// TrackFunctionReturn tracks a function return.
func (c *Client) TrackFunctionReturn(ctx context.Context, functionName string, returnValue interface{}, file string, line int) {
	c.captureEvent(ctx, EventKind{
		FunctionReturn: &FunctionReturnData{
			FunctionName: functionName,
			ReturnValue:  returnValue,
			File:         file,
			Line:         line,
		},
	})
}

// TrackHTTPRequest tracks an HTTP request.
func (c *Client) TrackHTTPRequest(ctx context.Context, method, url string, headers map[string]string, body interface{}) {
	c.captureEvent(ctx, EventKind{
		HTTPRequest: &HTTPRequestData{
			Method:  method,
			URL:     url,
			Headers: headers,
			Body:    body,
		},
	})
}

// TrackHTTPResponse tracks an HTTP response.
func (c *Client) TrackHTTPResponse(ctx context.Context, status int, headers map[string]string, body interface{}, durationMs int64) {
	c.captureEvent(ctx, EventKind{
		HTTPResponse: &HTTPResponseData{
			Status:     status,
			Headers:    headers,
			Body:       body,
			DurationMs: durationMs,
		},
	})
}

// TrackAsyncSpawn tracks spawning a goroutine.
func (c *Client) TrackAsyncSpawn(ctx context.Context, taskID, taskName, location string) {
	c.captureEvent(ctx, EventKind{
		AsyncSpawn: &AsyncSpawnData{
			TaskID:     taskID,
			TaskName:   taskName,
			SpawnedAt:  location,
		},
	})
}

// TrackAsyncAwait tracks waiting for an async operation.
func (c *Client) TrackAsyncAwait(ctx context.Context, futureID, location string) {
	c.captureEvent(ctx, EventKind{
		AsyncAwait: &AsyncAwaitData{
			FutureID:  futureID,
			AwaitedAt: location,
		},
	})
}

// TrackLockAcquire tracks acquiring a lock.
func (c *Client) TrackLockAcquire(ctx context.Context, lockID, lockType, location string) {
	c.captureEvent(ctx, EventKind{
		LockAcquire: &LockAcquireData{
			LockID:   lockID,
			LockType: lockType,
			Location: location,
		},
	})
}

// TrackLockRelease tracks releasing a lock.
func (c *Client) TrackLockRelease(ctx context.Context, lockID, location string) {
	c.captureEvent(ctx, EventKind{
		LockRelease: &LockReleaseData{
			LockID:   lockID,
			Location: location,
		},
	})
}

// TrackError tracks an error.
func (c *Client) TrackError(ctx context.Context, errorType, message string, stackTrace []string) {
	c.captureEvent(ctx, EventKind{
		Error: &ErrorData{
			ErrorType:  errorType,
			Message:    message,
			StackTrace: stackTrace,
		},
	})
}

func (c *Client) captureEvent(ctx context.Context, kind EventKind) {
	rctx := FromContext(ctx)
	if rctx == nil {
		if c.config.Debug {
			fmt.Printf("[Raceway] captureEvent called outside of Raceway context\n")
		}
		return
	}

	// Build causality vector: [(root_id, clock)]
	causalityVector := []CausalityEntry{}
	if rctx.RootID != nil {
		causalityVector = append(causalityVector, CausalityEntry{
			EventID: *rctx.RootID,
			Clock:   uint64(rctx.Clock),
		})
	}

	event := Event{
		ID:              uuid.New().String(),
		TraceID:         rctx.TraceID,
		ParentID:        rctx.ParentID,
		Timestamp:       time.Now().UTC().Format(time.RFC3339Nano),
		Kind:            kind,
		Metadata:        c.buildMetadata(rctx),
		CausalityVector: causalityVector,
		LockSet:         []string{},
	}

	// Update context: set root ID if first event, update parent, increment clock
	if rctx.RootID == nil {
		rctx.RootID = &event.ID
	}
	rctx.ParentID = &event.ID
	rctx.Clock++

	// Buffer event for sending
	c.mu.Lock()
	c.eventBuffer = append(c.eventBuffer, event)
	shouldFlush := len(c.eventBuffer) >= c.config.BatchSize
	c.mu.Unlock()

	if c.config.Debug {
		kindName := ""
		if kind.StateChange != nil {
			kindName = "StateChange"
		} else if kind.FunctionCall != nil {
			kindName = "FunctionCall"
		} else if kind.HTTPRequest != nil {
			kindName = "HttpRequest"
		} else if kind.HTTPResponse != nil {
			kindName = "HttpResponse"
		}
		fmt.Printf("[Raceway] Captured %s event %s\n", kindName, event.ID[:8])
	}

	if shouldFlush {
		go c.Flush()
	}
}

func (c *Client) buildMetadata(rctx *RacewayContext) Metadata {
	return Metadata{
		ThreadID:    rctx.ThreadID, // Use virtual thread ID from context
		ProcessID:   os.Getpid(),
		ServiceName: c.config.ServiceName,
		Environment: c.config.Environment,
		Tags:        map[string]string{},
		DurationNs:  nil,
	}
}

// Flush sends buffered events to the server.
func (c *Client) Flush() {
	c.mu.Lock()
	if len(c.eventBuffer) == 0 {
		c.mu.Unlock()
		return
	}

	events := make([]Event, len(c.eventBuffer))
	copy(events, c.eventBuffer)
	c.eventBuffer = c.eventBuffer[:0]
	c.mu.Unlock()

	payload := map[string]interface{}{
		"events": events,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		fmt.Printf("[Raceway] Error marshaling events: %v\n", err)
		return
	}

	resp, err := c.httpClient.Post(
		fmt.Sprintf("%s/events", c.config.Endpoint),
		"application/json",
		bytes.NewReader(data),
	)
	if err != nil {
		fmt.Printf("[Raceway] Error sending events: %v\n", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Printf("[Raceway] Failed to send events: status %d\n", resp.StatusCode)
	} else if c.config.Debug {
		fmt.Printf("[Raceway] Sent %d events\n", len(events))
	}
}

func (c *Client) autoFlush() {
	for {
		select {
		case <-c.flushTicker.C:
			c.Flush()
		case <-c.stopChan:
			return
		}
	}
}

// Shutdown flushes remaining events and stops the auto-flush goroutine.
func (c *Client) Shutdown() {
	close(c.stopChan)
	c.flushTicker.Stop()
	c.Flush()
}

// getGoroutineID returns the current goroutine ID (for debugging purposes).
func getGoroutineID() int {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	var id int
	fmt.Sscanf(string(buf[:n]), "goroutine %d ", &id)
	return id
}
