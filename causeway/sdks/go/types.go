package raceway

import "time"

// UUID type alias
type UUID = string

// Event represents a single traced event
type Event struct {
	ID              UUID                   `json:"id"`
	TraceID         UUID                   `json:"trace_id"`
	ParentID        *UUID                  `json:"parent_id"`
	Timestamp       string                 `json:"timestamp"`
	Kind            map[string]interface{} `json:"kind"`
	Metadata        EventMetadata          `json:"metadata"`
	CausalityVector [][]interface{}        `json:"causality_vector"`
	LockSet         []string               `json:"lock_set"`
}

// StateChangeData represents a variable read or write
type StateChangeData struct {
	Variable   string      `json:"variable"`
	OldValue   interface{} `json:"old_value"`
	NewValue   interface{} `json:"new_value"`
	Location   string      `json:"location"`
	AccessType string      `json:"access_type"` // "Read" or "Write"
}

// FunctionCallData represents a function entry
type FunctionCallData struct {
	FunctionName string                 `json:"function_name"`
	Module       string                 `json:"module"`
	Args         map[string]interface{} `json:"args"`
	File         string                 `json:"file"`
	Line         int                    `json:"line"`
}

// HttpRequestData represents an HTTP request
type HttpRequestData struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    interface{}       `json:"body,omitempty"`
}

// HttpResponseData represents an HTTP response
type HttpResponseData struct {
	Status     int               `json:"status"`
	Headers    map[string]string `json:"headers"`
	Body       interface{}       `json:"body,omitempty"`
	DurationMs uint64            `json:"duration_ms"`
}

// EventMetadata contains metadata for all events
type EventMetadata struct {
	ThreadID    string            `json:"thread_id"`
	ProcessID   int               `json:"process_id"`
	ServiceName string            `json:"service_name"`
	Environment string            `json:"environment"`
	Tags        map[string]string `json:"tags"`
	DurationNs  *uint64           `json:"duration_ns"`
}

// Config holds configuration for the Raceway client
type Config struct {
	ServerURL     string            // Raceway server URL (required)
	ServiceName   string            // Service identifier (default: "unknown-service")
	Environment   string            // Environment (default: "development")
	BatchSize     int               // Event batch size (default: 100)
	FlushInterval time.Duration     // Flush interval (default: 1 second)
	Tags          map[string]string // Custom tags for all events
	Debug         bool              // Debug logging (default: false)
	APIKey        *string           // Optional API key for authentication
}
