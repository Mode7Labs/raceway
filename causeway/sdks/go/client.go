package raceway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
)

// httpClient handles HTTP communication with Raceway server
type httpClient struct {
	serverURL   string
	batchSize   int
	debug       bool
	eventBuffer []*Event
	mu          sync.Mutex
	httpClient  *http.Client
}

// newHTTPClient creates a new HTTP client
func newHTTPClient(serverURL string, batchSize int, debug bool) *httpClient {
	return &httpClient{
		serverURL:   serverURL,
		batchSize:   batchSize,
		debug:       debug,
		eventBuffer: make([]*Event, 0, batchSize),
		httpClient:  &http.Client{},
	}
}

// BufferEvent adds an event to the buffer
func (c *httpClient) BufferEvent(event *Event) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.eventBuffer = append(c.eventBuffer, event)

	if c.debug {
		log.Printf("[Raceway] Buffered event %s (buffer size: %d)\n", event.ID, len(c.eventBuffer))
	}

	// Flush if batch size reached
	if len(c.eventBuffer) >= c.batchSize {
		c.flush()
	}
}

// Flush sends all buffered events to server
func (c *httpClient) Flush() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.flush()
}

// flush (internal, assumes mutex is held)
func (c *httpClient) flush() {
	if len(c.eventBuffer) == 0 {
		return
	}

	eventsToSend := make([]*Event, len(c.eventBuffer))
	copy(eventsToSend, c.eventBuffer)
	c.eventBuffer = c.eventBuffer[:0] // Clear buffer

	if c.debug {
		log.Printf("[Raceway] Flushing %d events to %s/events\n", len(eventsToSend), c.serverURL)
	}

	// Send in background to avoid blocking
	go c.sendEvents(eventsToSend)
}

// sendEvents sends events to server
func (c *httpClient) sendEvents(events []*Event) {
	payload := map[string]interface{}{
		"events": events,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Raceway] Error marshaling events: %v\n", err)
		return
	}

	if c.debug && len(events) > 0 {
		preview := string(jsonData)
		if len(preview) > 500 {
			preview = preview[:500] + "..."
		}
		log.Printf("[Raceway] Sample event JSON: %s\n", preview)
	}

	resp, err := c.httpClient.Post(
		fmt.Sprintf("%s/events", c.serverURL),
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		log.Printf("[Raceway] Error sending events: %v\n", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body := make([]byte, 1024)
		n, _ := resp.Body.Read(body)
		log.Printf("[Raceway] Server returned status %d: %s\n", resp.StatusCode, string(body[:n]))
		return
	}

	if c.debug {
		log.Printf("[Raceway] Successfully sent %d events\n", len(events))
	}
}
