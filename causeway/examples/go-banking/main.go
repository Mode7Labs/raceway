// Go Banking API - Raceway Demo
//
// This demonstrates how Raceway can detect race conditions in a Go/Gin banking API.
//
// To run:
// 1. Start Raceway server: cd ../.. && cargo run --release -- serve
// 2. Start this server: go run main.go
// 3. Open browser: http://localhost:3052
// 4. Click "Trigger Race Condition" to see the bug
// 5. View results: http://localhost:8080

package main

import (
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	raceway "github.com/mode-7/raceway-go"
)

// Application models
type Account struct {
	Balance int64 `json:"balance"`
}

type TransferRequest struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Amount int64  `json:"amount"`
}

type TransferResponse struct {
	Success bool        `json:"success"`
	From    AccountInfo `json:"from"`
	To      AccountInfo `json:"to"`
}

type AccountInfo struct {
	Account    string `json:"account"`
	NewBalance int64  `json:"newBalance"`
}

// Global state
var (
	accounts = map[string]*Account{
		"alice":   {Balance: 1000},
		"bob":     {Balance: 500},
		"charlie": {Balance: 300},
	}
	accountsMu     sync.RWMutex
	racewayClient  *raceway.Client
)

func main() {
	// Initialize Raceway client with optional API key from environment
	var apiKey *string
	if key := os.Getenv("RACEWAY_KEY"); key != "" {
		apiKey = &key
	}

	racewayClient = raceway.NewClient(raceway.Config{
		ServerURL:   "http://localhost:8080",
		ServiceName: "banking-api",
		Environment: "development",
		BatchSize:   10, // Lower batch size for faster flushing
		Debug:       true,
		APIKey:      apiKey,
	})
	defer racewayClient.Stop()

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()

	// Add Raceway middleware to automatically initialize traces
	router.Use(ginRacewayMiddleware())

	// API routes
	router.GET("/health", health)
	router.GET("/api/accounts", getAccounts)
	router.GET("/api/balance", getBalance)
	router.POST("/api/transfer", transfer)
	router.POST("/api/reset", resetAccounts)

	// Serve static files for all other routes
	router.NoRoute(gin.WrapH(http.FileServer(http.Dir("./public"))))

	port := os.Getenv("PORT")
	if port == "" {
		port = "3052"
	}

	fmt.Printf("\n💰 Banking API running on http://localhost:%s\n", port)
	fmt.Println("🔍 Raceway integration enabled")
	fmt.Printf("\n📊 Web UI: http://localhost:%s\n", port)
	fmt.Println("📊 Raceway Analysis: http://localhost:8080")
	fmt.Println("\n🚨 Click \"Trigger Race Condition\" in the UI to see the bug!\n")

	router.Run(":" + port)
}

// ginRacewayMiddleware wraps the Raceway middleware for Gin
func ginRacewayMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract or generate trace ID
		traceID := c.GetHeader("X-Trace-ID")
		if traceID == "" {
			traceID = uuid.New().String()
		}

		// Create Raceway context
		raceCtx := raceway.NewRacewayContext(traceID)
		ctx := raceway.WithRacewayContext(c.Request.Context(), raceCtx)

		// Track HTTP request
		racewayClient.TrackFunctionCall(ctx, "http_request", map[string]interface{}{
			"method": c.Request.Method,
			"path":   c.Request.URL.Path,
		})

		// Update request context
		c.Request = c.Request.WithContext(ctx)

		// Continue with request
		start := time.Now()
		c.Next()

		// Track HTTP response
		duration := uint64(time.Since(start).Milliseconds())
		racewayClient.TrackHTTPResponse(ctx, c.Writer.Status(), duration)
	}
}

func health(c *gin.Context) {
	c.JSON(200, gin.H{"status": "ok"})
}

func getAccounts(c *gin.Context) {
	ctx := c.Request.Context()
	defer racewayClient.StartFunction(ctx, "getAccounts", map[string]interface{}{})()

	accountsMu.RLock()
	defer accountsMu.RUnlock()

	c.JSON(200, gin.H{"accounts": accounts})
}

func getBalance(c *gin.Context) {
	ctx := c.Request.Context()
	account := c.Query("account")

	defer racewayClient.StartFunction(ctx, "getBalance", map[string]interface{}{
		"account": account,
	})()

	accountsMu.RLock()
	acc, exists := accounts[account]
	accountsMu.RUnlock()

	if !exists {
		c.JSON(404, gin.H{"error": "Account not found"})
		return
	}

	racewayClient.TrackStateChange(
		ctx,
		fmt.Sprintf("%s.balance", account),
		nil,
		acc.Balance,
		"Read",
	)

	c.JSON(200, acc)
}

func transfer(c *gin.Context) {
	ctx := c.Request.Context()

	var req TransferRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}

	// Track function with automatic duration measurement
	defer racewayClient.StartFunction(ctx, "transfer", map[string]interface{}{
		"from":   req.From,
		"to":     req.To,
		"amount": req.Amount,
	})()

	// Simulate processing time (makes race more likely)
	time.Sleep(10 * time.Millisecond)

	// READ: Get current balance (without holding lock - RACE CONDITION!)
	accountsMu.RLock()
	fromAcc, exists := accounts[req.From]
	accountsMu.RUnlock()

	if !exists {
		c.JSON(404, gin.H{"error": "Account not found"})
		return
	}

	balance := fromAcc.Balance
	racewayClient.TrackStateChange(
		ctx,
		fmt.Sprintf("%s.balance", req.From),
		nil,
		balance,
		"Read",
	)

	// Check sufficient funds
	if balance < req.Amount {
		c.JSON(400, gin.H{"error": "Insufficient funds"})
		return
	}

	// Simulate more processing (window for race condition!)
	time.Sleep(10 * time.Millisecond)

	// WRITE: Update balance (RACE CONDITION HERE!)
	newBalance := balance - req.Amount
	accountsMu.Lock()
	fromAcc.Balance = newBalance
	accountsMu.Unlock()

	racewayClient.TrackStateChange(
		ctx,
		fmt.Sprintf("%s.balance", req.From),
		balance,
		newBalance,
		"Write",
	)

	// Credit the recipient
	accountsMu.Lock()
	toAcc := accounts[req.To]
	oldToBalance := toAcc.Balance
	toAcc.Balance += req.Amount
	accountsMu.Unlock()

	racewayClient.TrackStateChange(
		ctx,
		fmt.Sprintf("%s.balance", req.To),
		oldToBalance,
		toAcc.Balance,
		"Write",
	)

	c.JSON(200, TransferResponse{
		Success: true,
		From: AccountInfo{
			Account:    req.From,
			NewBalance: newBalance,
		},
		To: AccountInfo{
			Account:    req.To,
			NewBalance: toAcc.Balance,
		},
	})
}

func resetAccounts(c *gin.Context) {
	ctx := c.Request.Context()
	defer racewayClient.StartFunction(ctx, "resetAccounts", map[string]interface{}{})()


	accountsMu.Lock()
	accounts["alice"] = &Account{Balance: 1000}
	accounts["bob"] = &Account{Balance: 500}
	accounts["charlie"] = &Account{Balance: 300}
	accountsMu.Unlock()

	c.JSON(200, gin.H{
		"message":  "Accounts reset",
		"accounts": accounts,
	})
}
