package raceway

import (
	"net/http"

	"github.com/google/uuid"
)

// Middleware returns HTTP middleware for automatic trace initialization
func (c *Client) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract or generate trace ID
		traceID := r.Header.Get("X-Trace-ID")
		if traceID == "" || !isValidUUID(traceID) {
			traceID = uuid.New().String()
		}

		// Create Raceway context
		raceCtx := NewRacewayContext(traceID)

		// Add to request context
		ctx := WithRacewayContext(r.Context(), raceCtx)

		// Track HTTP request
		c.trackHTTPRequest(ctx, r.Method, r.URL.Path)

		// Continue with updated context
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// isValidUUID checks if a string is a valid UUID
func isValidUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil
}
