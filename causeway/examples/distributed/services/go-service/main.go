package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	raceway "github.com/mode-7/raceway/raceway"
)

const (
	PORT         = 6003
	SERVICE_NAME = "go-service"
)

var client *raceway.Client

type ProcessRequest struct {
	Downstream     string `json:"downstream,omitempty"`
	NextDownstream string `json:"next_downstream,omitempty"`
	Payload        string `json:"payload"`
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
	config.Debug = true
	client = raceway.New(config)
	defer client.Shutdown()

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/process", processHandler)

	fmt.Printf("%s listening on port %d\n", SERVICE_NAME, PORT)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", PORT), nil))
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

	fmt.Printf("\n[%s] Received request\n", SERVICE_NAME)
	fmt.Printf("  traceparent: %s\n", r.Header.Get("traceparent"))
	fmt.Printf("  raceway-clock: %s\n", r.Header.Get("raceway-clock"))
	fmt.Printf("  downstream: %s\n", req.Downstream)

	// Track some work
	client.TrackFunctionCall(ctx, "processRequest", "", map[string]string{"payload": req.Payload}, "", 0)
	client.TrackStateChange(ctx, "requestCount", nil, 1, "", "Write")

	var downstreamResponse interface{}

	// Call downstream service if specified
	if req.Downstream != "" {
		fmt.Printf("  Calling downstream: %s\n", req.Downstream)

		headers, err := client.PropagationHeaders(ctx, nil)
		if err != nil {
			fmt.Printf("  Error getting propagation headers: %v\n", err)
		} else {
			fmt.Printf("  Propagating headers:\n")
			fmt.Printf("    traceparent: %s\n", headers["traceparent"])
			fmt.Printf("    raceway-clock: %s\n", headers["raceway-clock"])

			payload := map[string]interface{}{
				"payload":    fmt.Sprintf("%s → %s", SERVICE_NAME, req.Payload),
				"downstream": req.NextDownstream,
			}
			body, _ := json.Marshal(payload)

			httpReq, _ := http.NewRequest("POST", req.Downstream, bytes.NewReader(body))
			httpReq.Header.Set("Content-Type", "application/json")
			for k, v := range headers {
				httpReq.Header.Set(k, v)
			}

			resp, err := http.DefaultClient.Do(httpReq)
			if err != nil {
				fmt.Printf("  Error calling downstream: %v\n", err)
			} else {
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
