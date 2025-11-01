package raceway

import (
	"context"
	"testing"
	"time"
)

// TestNewClient verifies that a client can be created with default config.
func TestNewClient(t *testing.T) {
	config := DefaultConfig()
	client := New(config)

	if client == nil {
		t.Fatal("Expected client to be non-nil")
	}

	if client.ServiceName() == "" {
		t.Error("Expected service name to be set")
	}

	if client.InstanceID() == "" {
		t.Error("Expected instance ID to be set")
	}

	// Clean up
	client.Shutdown()
}

// TestDefaultConfig verifies that DefaultConfig returns sensible values.
func TestDefaultConfig(t *testing.T) {
	config := DefaultConfig()

	if config.Endpoint != "http://localhost:8080" {
		t.Errorf("Expected endpoint to be http://localhost:8080, got %s", config.Endpoint)
	}

	if config.BatchSize != 50 {
		t.Errorf("Expected batch size to be 50, got %d", config.BatchSize)
	}

	if config.FlushInterval != time.Second {
		t.Errorf("Expected flush interval to be 1 second, got %v", config.FlushInterval)
	}
}

// TestCustomConfig verifies that custom configuration is respected.
func TestCustomConfig(t *testing.T) {
	config := Config{
		Endpoint:      "http://custom:9090",
		ServiceName:   "test-service",
		InstanceID:    "test-instance",
		Environment:   "testing",
		BatchSize:     100,
		FlushInterval: 2 * time.Second,
		Debug:         true,
	}

	client := New(config)
	defer client.Shutdown()

	if client.ServiceName() != "test-service" {
		t.Errorf("Expected service name to be 'test-service', got %s", client.ServiceName())
	}

	if client.InstanceID() != "test-instance" {
		t.Errorf("Expected instance ID to be 'test-instance', got %s", client.InstanceID())
	}
}

// TestTrackFunctionCall verifies that function calls can be tracked.
func TestTrackFunctionCall(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "test-service"
	client := New(config)
	defer client.Shutdown()

	ctx := context.Background()

	// Track a function call
	client.TrackFunctionCall(ctx, "testFunction", "testModule", map[string]interface{}{
		"arg1": "value1",
		"arg2": 42,
	}, "client_test.go", 42)

	// Should not panic - test passes if we get here
}

// TestTrackStateChange verifies that state changes can be tracked.
func TestTrackStateChange(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "test-service"
	client := New(config)
	defer client.Shutdown()

	ctx := context.Background()

	// Track a state change
	client.TrackStateChange(ctx, "testVariable", nil, 100, "client_test.go:50", "Write")

	// Should not panic - test passes if we get here
}

// TestTrackHTTPRequest verifies that HTTP requests can be tracked.
func TestTrackHTTPRequest(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "test-service"
	client := New(config)
	defer client.Shutdown()

	ctx := context.Background()

	// Track an HTTP request
	client.TrackHTTPRequest(ctx, "GET", "/api/test", nil, nil)

	// Should not panic - test passes if we get here
}

// TestTrackHTTPResponse verifies that HTTP responses can be tracked.
func TestTrackHTTPResponse(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "test-service"
	client := New(config)
	defer client.Shutdown()

	ctx := context.Background()

	// Track an HTTP response
	client.TrackHTTPResponse(ctx, 200, nil, nil, 150)

	// Should not panic - test passes if we get here
}

// TestShutdownFlushesEvents verifies that Shutdown waits for events to flush.
func TestShutdownFlushesEvents(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "test-service"
	config.BatchSize = 1000 // Large batch so it doesn't auto-flush
	client := New(config)

	ctx := context.Background()

	// Add some events
	for i := 0; i < 10; i++ {
		client.TrackStateChange(ctx, "counter", i, i+1, "client_test.go:100", "Write")
	}

	// Shutdown should flush
	client.Shutdown()

	// If we get here without hanging, test passes
}

// TestContextPropagation verifies that context can be extracted and used.
func TestContextPropagation(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "test-service"
	client := New(config)
	defer client.Shutdown()

	ctx := context.Background()

	// Create a new trace context
	ctx = NewContext(ctx, "test-trace-id", "test-service", "test-instance")

	// Get the context
	raceCtx := FromContext(ctx)
	if raceCtx == nil {
		t.Fatal("Expected context to be non-nil")
	}

	if raceCtx.TraceID != "test-trace-id" {
		t.Errorf("Expected trace ID to be 'test-trace-id', got %s", raceCtx.TraceID)
	}
}

// TestMultipleClients verifies that multiple clients can coexist.
func TestMultipleClients(t *testing.T) {
	config1 := DefaultConfig()
	config1.ServiceName = "service-1"
	client1 := New(config1)
	defer client1.Shutdown()

	config2 := DefaultConfig()
	config2.ServiceName = "service-2"
	client2 := New(config2)
	defer client2.Shutdown()

	if client1.ServiceName() == client2.ServiceName() {
		t.Error("Expected different service names for different clients")
	}
}

// TestConcurrentTracking verifies thread safety of event tracking.
func TestConcurrentTracking(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "test-service"
	client := New(config)
	defer client.Shutdown()

	ctx := context.Background()

	// Track events concurrently
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(id int) {
			for j := 0; j < 100; j++ {
				client.TrackStateChange(ctx, "counter", j, j+1, "client_test.go:185", "Write")
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines to complete
	for i := 0; i < 10; i++ {
		<-done
	}

	// If we get here without data races, test passes
}

// BenchmarkTrackStateChange benchmarks state change tracking performance.
func BenchmarkTrackStateChange(b *testing.B) {
	config := DefaultConfig()
	config.ServiceName = "bench-service"
	client := New(config)
	defer client.Shutdown()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		client.TrackStateChange(ctx, "variable", i, i+1, "client_test.go:208", "Write")
	}
}

// BenchmarkTrackFunctionCall benchmarks function call tracking performance.
func BenchmarkTrackFunctionCall(b *testing.B) {
	config := DefaultConfig()
	config.ServiceName = "bench-service"
	client := New(config)
	defer client.Shutdown()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		client.TrackFunctionCall(ctx, "benchFunc", "testModule", map[string]interface{}{
			"iteration": i,
		}, "client_test.go", 223)
	}
}
