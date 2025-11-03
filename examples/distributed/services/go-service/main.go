package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	raceway "github.com/mode7labs/raceway/sdks/go"
)

const (
	PORT         = 6003
	SERVICE_NAME = "go-service"
)

var (
	client               *raceway.Client
	globalRequestCounter int
	counterLock          sync.Mutex
)

type ProcessRequest struct {
	Downstream         string `json:"downstream,omitempty"`
	NextDownstream     string `json:"next_downstream,omitempty"`
	NextNextDownstream string `json:"next_next_downstream,omitempty"`
	Payload            string `json:"payload"`
}

type ProcessResponse struct {
	Service         string            `json:"service"`
	ReceivedHeaders map[string]string `json:"receivedHeaders"`
	Payload         string            `json:"payload"`
	Downstream      interface{}       `json:"downstream,omitempty"`
}

func main() {
	config := raceway.DefaultConfig()
	config.ServiceName = SERVICE_NAME
	config.InstanceID = "go-1"
	client = raceway.New(config)

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/process", processHandler)

	// Setup graceful shutdown
	server := &http.Server{
		Addr: fmt.Sprintf(":%d", PORT),
	}

	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Printf("\n[%s] Shutting down, flushing events...\n", SERVICE_NAME)
		client.Shutdown()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
		os.Exit(0)
	}()

	fmt.Printf("%s listening on port %d\n", SERVICE_NAME, PORT)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"service": SERVICE_NAME,
		"status":  "healthy",
	})
}

func processHandler(w http.ResponseWriter, r *http.Request) {
	// Parse incoming headers
	parsed := raceway.ParseIncomingHeaders(r.Header, client.ServiceName(), client.InstanceID())

	// Create context with parsed trace info
	ctx := raceway.NewContext(r.Context(), parsed.TraceID, client.ServiceName(), client.InstanceID())
	if rctx := raceway.FromContext(ctx); rctx != nil {
		rctx.SpanID = parsed.SpanID
		rctx.ParentSpanID = parsed.ParentSpanID
		rctx.Distributed = parsed.Distributed
		rctx.ClockVector = parsed.ClockVector
		rctx.TraceState = parsed.TraceState
	}

	// Track HTTP request
	client.TrackHTTPRequest(ctx, r.Method, r.URL.Path, nil, nil)

	// Parse request body
	var req ProcessRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Track some work
	client.TrackFunctionCall(ctx, "processRequest", "", map[string]string{"payload": req.Payload}, "", 0)

	// Increment request counter with lock tracking (using new WithLock helper)
	client.WithLock(ctx, &counterLock, "global_request_counter", "Mutex", func() {
		oldCount := globalRequestCounter
		globalRequestCounter++
		client.TrackStateChange(ctx, "requestCount", oldCount, globalRequestCounter, "", "Write")
	})

	var downstreamResponse interface{}

	// Call downstream service if specified
	if req.Downstream != "" {
		headers, err := client.PropagationHeaders(ctx, nil)
		if err == nil {
			payload := map[string]interface{}{
				"payload":         fmt.Sprintf("%s → %s", SERVICE_NAME, req.Payload),
				"downstream":      req.NextDownstream,
				"next_downstream": req.NextNextDownstream,
			}
			body, _ := json.Marshal(payload)

			httpReq, _ := http.NewRequest("POST", req.Downstream, bytes.NewReader(body))
			httpReq.Header.Set("Content-Type", "application/json")
			for k, v := range headers {
				httpReq.Header.Set(k, v)
			}

			resp, err := http.DefaultClient.Do(httpReq)
			if err == nil {
				defer resp.Body.Close()
				body, _ := io.ReadAll(resp.Body)
				json.Unmarshal(body, &downstreamResponse)
			}
		}
	}

	response := ProcessResponse{
		Service: SERVICE_NAME,
		ReceivedHeaders: map[string]string{
			"traceparent":   r.Header.Get("traceparent"),
			"raceway-clock": r.Header.Get("raceway-clock"),
		},
		Payload:    req.Payload,
		Downstream: downstreamResponse,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
