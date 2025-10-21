package raceway

import (
	"context"
	"fmt"
	"log"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Client is the main Raceway SDK client
type Client struct {
	config     Config
	httpClient *httpClient
	stopCh     chan struct{}
	wg         sync.WaitGroup
}

// NewClient creates a new Raceway client
func NewClient(config Config) *Client {
	// Set defaults
	if config.ServiceName == "" {
		config.ServiceName = "unknown-service"
	}
	if config.Environment == "" {
		config.Environment = "development"
	}
	if config.BatchSize == 0 {
		config.BatchSize = 100
	}
	if config.FlushInterval == 0 {
		config.FlushInterval = 1 * time.Second
	}
	if config.Tags == nil {
		config.Tags = make(map[string]string)
	}

	client := &Client{
		config:     config,
		httpClient: newHTTPClient(config.ServerURL, config.BatchSize, config.Debug, config.APIKey),
		stopCh:     make(chan struct{}),
	}

	// Start background flush goroutine
	client.wg.Add(1)
	go client.autoFlush()

	if config.Debug {
		log.Printf("[Raceway] Initialized with config: %+v\n", config)
	}

	return client
}

// autoFlush runs in background and flushes events periodically
func (c *Client) autoFlush() {
	defer c.wg.Done()
	ticker := time.NewTicker(c.config.FlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.httpClient.Flush()
		case <-c.stopCh:
			// Final flush before stopping
			c.httpClient.Flush()
			return
		}
	}
}

// Stop stops the client and flushes remaining events
func (c *Client) Stop() {
	close(c.stopCh)
	c.wg.Wait()
}

// TrackStateChange tracks a variable read or write
func (c *Client) TrackStateChange(
	ctx context.Context,
	variable string,
	oldValue interface{},
	newValue interface{},
	accessType string, // "Read" or "Write"
) {
	raceCtx := GetRacewayContext(ctx)
	if raceCtx == nil {
		if c.config.Debug {
			log.Println("[Raceway] TrackStateChange called outside of context")
		}
		return
	}

	// Capture location (skip 1 frame to get caller)
	_, file, line, _ := runtime.Caller(1)
	location := fmt.Sprintf("%s:%d", file, line)

	// Check if first event while holding lock
	raceCtx.mu.Lock()
	isFirstEvent := raceCtx.RootID == nil
	raceCtx.mu.Unlock()

	event := c.captureEvent(
		raceCtx,
		map[string]interface{}{
			"StateChange": StateChangeData{
				Variable:   variable,
				OldValue:   oldValue,
				NewValue:   newValue,
				Location:   location,
				AccessType: accessType,
			},
		},
		nil,
	)

	raceCtx.Update(event.ID, isFirstEvent)
}

// TrackFunctionCall tracks a function entry
func (c *Client) TrackFunctionCall(
	ctx context.Context,
	functionName string,
	args map[string]interface{},
) {
	c.TrackFunctionCallWithDuration(ctx, functionName, args, nil)
}

// TrackFunctionCallWithDuration tracks a function entry with optional duration
func (c *Client) TrackFunctionCallWithDuration(
	ctx context.Context,
	functionName string,
	args map[string]interface{},
	durationNs *uint64,
) {
	raceCtx := GetRacewayContext(ctx)
	if raceCtx == nil {
		return
	}

	// Capture location
	_, file, line, _ := runtime.Caller(2)

	// Check if first event while holding lock
	raceCtx.mu.Lock()
	isFirstEvent := raceCtx.RootID == nil
	raceCtx.mu.Unlock()

	event := c.captureEvent(
		raceCtx,
		map[string]interface{}{
			"FunctionCall": FunctionCallData{
				FunctionName: functionName,
				Module:       "app",
				Args:         args,
				File:         file,
				Line:         line,
			},
		},
		durationNs,
	)

	raceCtx.Update(event.ID, isFirstEvent)
}

// TrackFunction tracks a function with automatic duration measurement
func (c *Client) TrackFunction(
	ctx context.Context,
	functionName string,
	args map[string]interface{},
	fn func() interface{},
) interface{} {
	start := time.Now()
	result := fn()
	duration := uint64(time.Since(start).Nanoseconds())

	c.TrackFunctionCallWithDuration(ctx, functionName, args, &duration)
	return result
}

// StartFunction starts tracking a function and returns a done() func to be called with defer.
// This is the idiomatic Go pattern for tracking function duration.
//
// Example:
//   defer client.StartFunction(ctx, "myFunction", args)()
func (c *Client) StartFunction(
	ctx context.Context,
	functionName string,
	args map[string]interface{},
) func() {
	start := time.Now()
	return func() {
		duration := uint64(time.Since(start).Nanoseconds())
		c.TrackFunctionCallWithDuration(ctx, functionName, args, &duration)
	}
}

// trackHTTPRequest tracks an HTTP request (internal - called by middleware)
func (c *Client) trackHTTPRequest(ctx context.Context, method, url string) {
	raceCtx := GetRacewayContext(ctx)
	if raceCtx == nil {
		return
	}

	event := c.captureEvent(
		raceCtx,
		map[string]interface{}{
			"HttpRequest": HttpRequestData{
				Method:  method,
				URL:     url,
				Headers: make(map[string]string),
				Body:    nil,
			},
		},
		nil,
	)

	raceCtx.Update(event.ID, true) // HTTP request is always a root
}

// TrackHTTPResponse tracks an HTTP response
func (c *Client) TrackHTTPResponse(ctx context.Context, status int, durationMs uint64) {
	raceCtx := GetRacewayContext(ctx)
	if raceCtx == nil {
		return
	}

	// Convert duration from ms to ns for metadata
	durationNs := durationMs * 1_000_000

	event := c.captureEvent(
		raceCtx,
		map[string]interface{}{
			"HttpResponse": HttpResponseData{
				Status:     status,
				Headers:    make(map[string]string),
				Body:       nil,
				DurationMs: durationMs,
			},
		},
		&durationNs,
	)

	raceCtx.Update(event.ID, false)
}

// captureEvent creates and buffers an event
func (c *Client) captureEvent(raceCtx *RacewayContext, kind map[string]interface{}, durationNs *uint64) *Event {
	// Lock to read current state
	raceCtx.mu.Lock()
	traceID := raceCtx.TraceID
	goroutineID := raceCtx.GoroutineID
	parentID := raceCtx.ParentID
	rootID := raceCtx.RootID
	clock := raceCtx.Clock
	raceCtx.mu.Unlock()

	// Build causality vector
	var causalityVector [][]interface{}
	if rootID != nil {
		causalityVector = [][]interface{}{
			{*rootID, clock},
		}
	} else {
		causalityVector = [][]interface{}{}
	}

	event := &Event{
		ID:              uuid.New().String(),
		TraceID:         traceID,
		ParentID:        parentID,
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
		Kind:            kind,
		Metadata:        c.buildMetadata(goroutineID, durationNs),
		CausalityVector: causalityVector,
		LockSet:         []string{},
	}

	c.httpClient.BufferEvent(event)

	if c.config.Debug {
		log.Printf("[Raceway] Captured event %s\n", event.ID)
	}

	return event
}

// buildMetadata creates event metadata
func (c *Client) buildMetadata(goroutineID string, durationNs *uint64) EventMetadata {
	return EventMetadata{
		ThreadID:    goroutineID,
		ProcessID:   os.Getpid(),
		ServiceName: c.config.ServiceName,
		Environment: c.config.Environment,
		Tags:        c.config.Tags,
		DurationNs:  durationNs,
	}
}
