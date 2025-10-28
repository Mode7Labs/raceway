// Package raceway provides a lightweight SDK for race condition detection in Go applications.
package raceway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
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
	// InstanceID distinguishes this instance in distributed clocks (default: hostname-pid)
	InstanceID string
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
		InstanceID:    "",
		Environment:   env,
		BatchSize:     50,
		FlushInterval: time.Second,
		Debug:         false,
	}
}

// Client is the main Raceway SDK client.
type Client struct {
	config      Config
	instanceID  string
	eventBuffer []Event
	mu          sync.Mutex
	httpClient  *http.Client
	flushTicker *time.Ticker
	stopChan    chan struct{}
}

// ServiceName returns the configured service name.
func (c *Client) ServiceName() string {
	return c.config.ServiceName
}

// InstanceID returns the instance identifier.
func (c *Client) InstanceID() string {
	return c.instanceID
}

// New creates a new Raceway client.
func New(config Config) *Client {
	instanceID := config.InstanceID
	if instanceID == "" {
		host, err := os.Hostname()
		if err != nil || host == "" {
			host = "instance"
		}
		instanceID = fmt.Sprintf("%s-%d", host, os.Getpid())
	}

	client := &Client{
		config:      config,
		instanceID:  instanceID,
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
		if gc, ok := ginCtx.(interface{ Request() *http.Request }); ok {
			req := gc.Request()
			parsed := ParseIncomingHeaders(req.Header, c.config.ServiceName, c.instanceID)

			// Create Raceway context and attach to request context
			ctxWith := NewContext(req.Context(), parsed.TraceID, c.config.ServiceName, c.instanceID)
			if rctx := FromContext(ctxWith); rctx != nil {
				rctx.SpanID = parsed.SpanID
				rctx.ParentSpanID = parsed.ParentSpanID
				rctx.Distributed = parsed.Distributed
				rctx.ClockVector = parsed.ClockVector
				rctx.TraceState = parsed.TraceState
			}

			// Track HTTP request as root event
			c.TrackHTTPRequest(ctxWith, req.Method, req.URL.Path, nil, nil)

			// Update request with new context
			*req = *req.WithContext(ctxWith)
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
	if headers == nil {
		headers = make(map[string]string)
	}
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
	if headers == nil {
		headers = make(map[string]string)
	}
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
			TaskID:    taskID,
			TaskName:  taskName,
			SpawnedAt: location,
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

// captureLocation captures the file:line of the caller.
// skip parameter controls how many stack frames to skip (2 = caller's caller).
func captureLocation(skip int) string {
	_, file, line, ok := runtime.Caller(skip)
	if !ok {
		return "unknown:0"
	}
	return fmt.Sprintf("%s:%d", filepath.Base(file), line)
}

// TrackLockAcquire tracks acquiring a lock.
// Location is automatically captured from the call site.
func (c *Client) TrackLockAcquire(ctx context.Context, lockID, lockType string) {
	location := captureLocation(2)
	c.captureEvent(ctx, EventKind{
		LockAcquire: &LockAcquireData{
			LockID:   lockID,
			LockType: lockType,
			Location: location,
		},
	})
}

// TrackLockRelease tracks releasing a lock.
// Location is automatically captured from the call site.
func (c *Client) TrackLockRelease(ctx context.Context, lockID, lockType string) {
	location := captureLocation(2)
	c.captureEvent(ctx, EventKind{
		LockRelease: &LockReleaseData{
			LockID:   lockID,
			LockType: lockType,
			Location: location,
		},
	})
}

// WithLock executes fn while holding the lock, automatically tracking acquire/release.
// This is the recommended way to track locks as it ensures release is always tracked.
//
// Example:
//
//	client.WithLock(ctx, &accountLock, "account_lock", "Mutex", func() {
//	    accounts["alice"].Balance -= 100
//	})
func (c *Client) WithLock(ctx context.Context, lock sync.Locker, lockID, lockType string, fn func()) {
	c.TrackLockAcquire(ctx, lockID, lockType)
	lock.Lock()
	defer func() {
		c.TrackLockRelease(ctx, lockID, lockType)
		lock.Unlock()
	}()
	fn()
}

// WithRWLockRead executes fn while holding a read lock, automatically tracking acquire/release.
//
// Example:
//
//	client.WithRWLockRead(ctx, &accountLock, "account_lock", func() {
//	    balance := accounts["alice"].Balance
//	    fmt.Println(balance)
//	})
func (c *Client) WithRWLockRead(ctx context.Context, lock *sync.RWMutex, lockID string, fn func()) {
	c.TrackLockAcquire(ctx, lockID, "RWLock-Read")
	lock.RLock()
	defer func() {
		c.TrackLockRelease(ctx, lockID, "RWLock-Read")
		lock.RUnlock()
	}()
	fn()
}

// WithRWLockWrite executes fn while holding a write lock, automatically tracking acquire/release.
//
// Example:
//
//	client.WithRWLockWrite(ctx, &accountLock, "account_lock", func() {
//	    accounts["alice"].Balance -= 100
//	})
func (c *Client) WithRWLockWrite(ctx context.Context, lock *sync.RWMutex, lockID string, fn func()) {
	c.TrackLockAcquire(ctx, lockID, "RWLock-Write")
	lock.Lock()
	defer func() {
		c.TrackLockRelease(ctx, lockID, "RWLock-Write")
		lock.Unlock()
	}()
	fn()
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

// PropagationHeaders builds outbound headers for distributed tracing.
func (c *Client) PropagationHeaders(ctx context.Context, extra map[string]string) (map[string]string, error) {
	rctx := FromContext(ctx)
	if rctx == nil {
		return nil, fmt.Errorf("raceway: propagation headers requested outside of active context")
	}

	result := BuildPropagationHeaders(rctx.TraceID, rctx.SpanID, rctx.TraceState, rctx.ClockVector, rctx.ServiceName, rctx.InstanceID)

	rctx.ClockVector = result.ClockVector
	rctx.Distributed = true
	// Do NOT modify rctx.SpanID - this context should keep using its own span ID
	// The child span ID is only for the downstream service in the headers

	headers := make(map[string]string, len(result.Headers))
	for k, v := range result.Headers {
		headers[k] = v
	}
	for k, v := range extra {
		headers[k] = v
	}

	return headers, nil
}

func (c *Client) captureEvent(ctx context.Context, kind EventKind) {
	rctx := FromContext(ctx)
	if rctx == nil {
		if c.config.Debug {
			fmt.Printf("[Raceway] captureEvent called outside of Raceway context\n")
		}
		return
	}

	// Increment local clock component and clone vector for event payload
	rctx.ClockVector = incrementClockVector(rctx.ClockVector, rctx.ServiceName, rctx.InstanceID)
	causalityVector := make([]CausalityEntry, len(rctx.ClockVector))
	copy(causalityVector, rctx.ClockVector)

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
	// Phase 2: Always populate distributed tracing fields when we have a context
	// This ensures entry-point services also create distributed spans
	instanceID := &rctx.InstanceID
	spanID := &rctx.SpanID
	upstreamSpanID := rctx.ParentSpanID

	return Metadata{
		ThreadID:    rctx.ThreadID, // Use virtual thread ID from context
		ProcessID:   os.Getpid(),
		ServiceName: c.config.ServiceName,
		Environment: c.config.Environment,
		Tags:        map[string]string{"sdk_language": "go"},
		DurationNs:  nil,
		// Phase 2: Distributed tracing fields
		InstanceID:        instanceID,
		DistributedSpanID: spanID,
		UpstreamSpanID:    upstreamSpanID,
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
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("[Raceway] Failed to send events: status %d, body: %s\n", resp.StatusCode, string(body))
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
