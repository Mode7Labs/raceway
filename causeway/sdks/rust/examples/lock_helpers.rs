/*!
Example demonstrating the lock helper improvements in Rust SDK.

This shows the before/after comparison for lock tracking:
- Before: 4 lines of manual tracking
- After: 1 line with RAII wrappers (75% reduction)
*/

use raceway_sdk::{RacewayClient, TrackedMutex, TrackedRwLock};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let client = Arc::new(RacewayClient::new(
        "http://localhost:8080",
        "lock-example",
    ));

    println!("=== Raceway Lock Helper Examples ===\n");

    // Example 1: Mutex with RAII wrapper
    println!("=== Mutex Example ===");
    let account_balance = TrackedMutex::new(1000, client.clone(), "account_balance");

    {
        // Lock is automatically tracked on acquire and release
        let mut balance = account_balance.lock("Mutex");
        *balance -= 100;
        println!("Balance after withdrawal: {}", *balance);
        // Lock release is automatically tracked when guard is dropped here
    }

    // Example 2: RwLock with read lock
    println!("\n=== RwLock Read Example ===");
    let data = TrackedRwLock::new(
        vec![1, 2, 3, 4, 5],
        client.clone(),
        "shared_data",
    );

    {
        let data_ref = data.read();
        println!("Data length: {}", data_ref.len());
        println!("First element: {}", data_ref[0]);
        // Read lock automatically released
    }

    // Example 3: RwLock with write lock
    println!("\n=== RwLock Write Example ===");
    {
        let mut data_mut = data.write();
        data_mut.push(6);
        println!("Added element, new length: {}", data_mut.len());
        // Write lock automatically released
    }

    println!("\n=== BEFORE vs AFTER Comparison ===");
    println!("Before (manual tracking): 4 lines per lock operation");
    println!("  1. client.track_lock_acquire()");
    println!("  2. lock.lock()");
    println!("  3. client.track_lock_release()");
    println!("  4. drop(guard)");
    println!("\nAfter (RAII wrapper): 1 line!");
    println!("  let guard = tracked_mutex.lock(\"Mutex\");");
    println!("\n✅ Lock helpers reduce boilerplate by 75%!");

    // Cleanup
    client.shutdown();
}
