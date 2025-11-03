package main

import (
	"context"
	"fmt"
	"sync"

	raceway "github.com/mode7labs/raceway/sdks/go"
)

// Example demonstrating the lock helper improvements

func main() {
	config := raceway.DefaultConfig()
	config.ServiceName = "lock-example"
	client := raceway.New(config)
	defer client.Shutdown()

	ctx := raceway.NewContext(context.Background(), "trace-123", "lock-example", "instance-1")

	var accountLock sync.Mutex
	var accountBalance int = 1000

	// BEFORE: Manual tracking (4 lines for 1 lock operation)
	fmt.Println("=== BEFORE: Manual Tracking ===")
	client.TrackLockAcquire(ctx, "account_lock", "Mutex")
	accountLock.Lock()
	accountBalance -= 100
	fmt.Printf("Balance after withdrawal: %d\n", accountBalance)
	client.TrackLockRelease(ctx, "account_lock", "Mutex")
	accountLock.Unlock()

	// AFTER: Lock helper (1 line!)
	fmt.Println("\n=== AFTER: WithLock Helper ===")
	client.WithLock(ctx, &accountLock, "account_lock", "Mutex", func() {
		accountBalance -= 100
		fmt.Printf("Balance after withdrawal: %d\n", accountBalance)
	})

	// RWLock examples
	var dataLock sync.RWMutex
	data := map[string]int{"counter": 0}

	fmt.Println("\n=== Read Lock Example ===")
	client.WithRWLockRead(ctx, &dataLock, "data_lock", func() {
		fmt.Printf("Counter value: %d\n", data["counter"])
	})

	fmt.Println("\n=== Write Lock Example ===")
	client.WithRWLockWrite(ctx, &dataLock, "data_lock", func() {
		data["counter"]++
		fmt.Printf("Counter incremented to: %d\n", data["counter"])
	})

	fmt.Println("\n✅ Lock helpers reduce boilerplate by 75%!")
}
