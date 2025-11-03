package raceway

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMiddleware(t *testing.T) {
	// Create a test server
	config := DefaultConfig()
	config.ServiceName = "test-service"
	client := New(config)
	defer client.Shutdown()

	// Create a simple handler
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify context is available
		rctx := FromContext(r.Context())
		if rctx == nil {
			t.Error("Expected Raceway context to be set by middleware")
			return
		}

		// Verify trace ID is set
		if rctx.TraceID == "" {
			t.Error("Expected trace ID to be set")
		}

		// Verify service name
		if rctx.ServiceName != "test-service" {
			t.Errorf("Expected service name 'test-service', got %s", rctx.ServiceName)
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Wrap with middleware
	wrappedHandler := client.Middleware(handler)

	// Create test request
	req := httptest.NewRequest("GET", "/api/test", nil)
	rec := httptest.NewRecorder()

	// Execute request
	wrappedHandler.ServeHTTP(rec, req)

	// Verify response
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}

	body, _ := io.ReadAll(rec.Body)
	if string(body) != "OK" {
		t.Errorf("Expected body 'OK', got %s", string(body))
	}
}

func TestMiddlewareWithTraceparent(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "test-service"
	client := New(config)
	defer client.Shutdown()

	traceID := "550e8400-e29b-41d4-a716-446655440000"
	expectedTraceparentID := "550e8400e29b41d4a716446655440000" // UUID with dashes removed

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rctx := FromContext(r.Context())
		if rctx == nil {
			t.Error("Expected Raceway context to be set")
			return
		}

		// Verify the trace ID matches what was sent in the header
		if rctx.TraceID != traceID {
			t.Errorf("Expected trace ID %s, got %s", traceID, rctx.TraceID)
		}

		// Verify distributed flag is set
		if !rctx.Distributed {
			t.Error("Expected distributed flag to be true when traceparent header is present")
		}

		w.WriteHeader(http.StatusOK)
	})

	wrappedHandler := client.Middleware(handler)

	req := httptest.NewRequest("GET", "/api/test", nil)
	// Set W3C traceparent header
	req.Header.Set("traceparent", "00-"+expectedTraceparentID+"-0123456789abcdef-01")
	rec := httptest.NewRecorder()

	wrappedHandler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestMiddlewareContextPropagation(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "test-service"
	client := New(config)
	defer client.Shutdown()

	var capturedTraceID string

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rctx := FromContext(r.Context())
		if rctx == nil {
			t.Error("Expected Raceway context")
			return
		}

		capturedTraceID = rctx.TraceID

		// Simulate calling downstream service
		headers, err := client.PropagationHeaders(r.Context(), nil)
		if err != nil {
			t.Errorf("Expected no error from PropagationHeaders, got %v", err)
			return
		}

		// Verify headers contain required fields
		if _, ok := headers["traceparent"]; !ok {
			t.Error("Expected traceparent header in propagation headers")
		}
		if _, ok := headers["raceway-clock"]; !ok {
			t.Error("Expected raceway-clock header in propagation headers")
		}

		w.WriteHeader(http.StatusOK)
	})

	wrappedHandler := client.Middleware(handler)

	req := httptest.NewRequest("POST", "/api/checkout", nil)
	rec := httptest.NewRecorder()

	wrappedHandler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}

	if capturedTraceID == "" {
		t.Error("Expected trace ID to be captured")
	}
}

// mockGinContext simulates a Gin context for testing
type mockGinContext struct {
	request *http.Request
	called  bool
}

func (m *mockGinContext) Request() *http.Request {
	return m.request
}

func (m *mockGinContext) Next() {
	m.called = true
}

func TestGinMiddleware(t *testing.T) {
	config := DefaultConfig()
	config.ServiceName = "gin-test-service"
	client := New(config)
	defer client.Shutdown()

	mock := &mockGinContext{
		request: httptest.NewRequest("GET", "/api/test", nil),
		called:  false,
	}

	// Set traceparent header
	mock.request.Header.Set("traceparent", "00-550e8400e29b41d4a716446655440000-0123456789abcdef-01")

	middleware := client.GinMiddleware()

	// Call middleware
	middleware(mock)

	// Verify context was set on request
	rctx := FromContext(mock.request.Context())
	if rctx == nil {
		t.Error("Expected Raceway context to be set by Gin middleware")
	}

	// Verify Next was called
	if !mock.called {
		t.Error("Expected Gin middleware to call Next()")
	}
}
