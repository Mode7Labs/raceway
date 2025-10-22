package raceway

// Metadata contains metadata about an event.
type Metadata struct {
	ThreadID    string            `json:"thread_id"`
	ProcessID   int               `json:"process_id"`
	ServiceName string            `json:"service_name"`
	Environment string            `json:"environment"`
	Tags        map[string]string `json:"tags"`
	DurationNs  *int64            `json:"duration_ns"`
	// Phase 2: Distributed tracing fields
	InstanceID         *string `json:"instance_id,omitempty"`
	DistributedSpanID  *string `json:"distributed_span_id,omitempty"`
	UpstreamSpanID     *string `json:"upstream_span_id,omitempty"`
}

// CausalityEntry represents a single entry in the causality vector.
// It serializes as a JSON array [component, value] to match the backend format.
type CausalityEntry [2]interface{} // [component (string), value (uint64)]

// NewCausalityEntry creates a new causality entry.
func NewCausalityEntry(component string, value uint64) CausalityEntry {
	return CausalityEntry{component, value}
}

// Component returns the component name.
func (c CausalityEntry) Component() string {
	if len(c) > 0 {
		if s, ok := c[0].(string); ok {
			return s
		}
	}
	return ""
}

// Value returns the clock value.
func (c CausalityEntry) Value() uint64 {
	if len(c) > 1 {
		switch v := c[1].(type) {
		case uint64:
			return v
		case float64:
			return uint64(v)
		case int:
			return uint64(v)
		}
	}
	return 0
}

// Event represents a single instrumentation event.
type Event struct {
	ID              string           `json:"id"`
	TraceID         string           `json:"trace_id"`
	ParentID        *string          `json:"parent_id"`
	Timestamp       string           `json:"timestamp"`
	Kind            EventKind        `json:"kind"`
	Metadata        Metadata         `json:"metadata"`
	CausalityVector []CausalityEntry `json:"causality_vector"`
	LockSet         []string         `json:"lock_set"`
}

// EventKind represents the different types of events.
// Only one field should be non-nil.
type EventKind struct {
	StateChange    *StateChangeData    `json:"StateChange,omitempty"`
	FunctionCall   *FunctionCallData   `json:"FunctionCall,omitempty"`
	FunctionReturn *FunctionReturnData `json:"FunctionReturn,omitempty"`
	AsyncSpawn     *AsyncSpawnData     `json:"AsyncSpawn,omitempty"`
	AsyncAwait     *AsyncAwaitData     `json:"AsyncAwait,omitempty"`
	LockAcquire    *LockAcquireData    `json:"LockAcquire,omitempty"`
	LockRelease    *LockReleaseData    `json:"LockRelease,omitempty"`
	HTTPRequest    *HTTPRequestData    `json:"HttpRequest,omitempty"`
	HTTPResponse   *HTTPResponseData   `json:"HttpResponse,omitempty"`
	Error          *ErrorData          `json:"Error,omitempty"`
}

// StateChangeData represents a read or write to a variable.
type StateChangeData struct {
	Variable   string      `json:"variable"`
	OldValue   interface{} `json:"old_value"`
	NewValue   interface{} `json:"new_value"`
	Location   string      `json:"location"`
	AccessType string      `json:"access_type"`
}

// FunctionCallData represents a function entry.
type FunctionCallData struct {
	FunctionName string      `json:"function_name"`
	Module       string      `json:"module"`
	Args         interface{} `json:"args"`
	File         string      `json:"file"`
	Line         int         `json:"line"`
}

// FunctionReturnData represents a function return.
type FunctionReturnData struct {
	FunctionName string      `json:"function_name"`
	ReturnValue  interface{} `json:"return_value"`
	File         string      `json:"file"`
	Line         int         `json:"line"`
}

// AsyncSpawnData represents spawning an async task.
type AsyncSpawnData struct {
	TaskID    string `json:"task_id"`
	TaskName  string `json:"task_name"`
	SpawnedAt string `json:"spawned_at"`
}

// AsyncAwaitData represents awaiting an async operation.
type AsyncAwaitData struct {
	FutureID  string `json:"future_id"`
	AwaitedAt string `json:"awaited_at"`
}

// LockAcquireData represents acquiring a lock.
type LockAcquireData struct {
	LockID   string `json:"lock_id"`
	LockType string `json:"lock_type"`
	Location string `json:"location"`
}

// LockReleaseData represents releasing a lock.
type LockReleaseData struct {
	LockID   string `json:"lock_id"`
	Location string `json:"location"`
}

// HTTPRequestData represents an HTTP request.
type HTTPRequestData struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    interface{}       `json:"body"`
}

// HTTPResponseData represents an HTTP response.
type HTTPResponseData struct {
	Status     int               `json:"status"`
	Headers    map[string]string `json:"headers"`
	Body       interface{}       `json:"body"`
	DurationMs int64             `json:"duration_ms"`
}

// ErrorData represents an error.
type ErrorData struct {
	ErrorType  string   `json:"error_type"`
	Message    string   `json:"message"`
	StackTrace []string `json:"stack_trace"`
}
