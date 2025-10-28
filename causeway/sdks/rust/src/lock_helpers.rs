/*!
Lock tracking helpers with RAII pattern for automatic acquire/release tracking.

This module provides wrapper types for Rust's standard synchronization primitives
that automatically track lock operations with Raceway.

# Examples

## Mutex

```rust,no_run
use raceway_sdk::{RacewayClient, TrackedMutex};
use std::sync::Arc;

let raceway = Arc::new(RacewayClient::new("http://localhost:8080", "my-service"));
let mutex = TrackedMutex::new(100, raceway.clone(), "account_balance");

// Lock is automatically tracked on acquire and release
let mut balance = mutex.lock("Mutex");
*balance -= 50;
// Lock release is automatically tracked when guard is dropped
```

## RwLock

```rust,no_run
use raceway_sdk::{RacewayClient, TrackedRwLock};
use std::sync::Arc;

let raceway = Arc::new(RacewayClient::new("http://localhost:8080", "my-service"));
let rwlock = TrackedRwLock::new(100, raceway.clone(), "account_balance");

// Read lock
{
    let balance = rwlock.read();
    println!("Balance: {}", *balance);
}

// Write lock
{
    let mut balance = rwlock.write();
    *balance -= 50;
}
```
*/

use crate::RacewayClient;
use std::ops::{Deref, DerefMut};
use std::sync::{Arc, Mutex, RwLock};

/// A wrapper around `std::sync::Mutex` that automatically tracks lock operations.
///
/// This provides the same API as `Mutex` but automatically calls Raceway's
/// lock tracking methods when the lock is acquired and released.
pub struct TrackedMutex<T> {
    inner: Mutex<T>,
    client: Arc<RacewayClient>,
    lock_id: String,
}

impl<T> TrackedMutex<T> {
    /// Create a new tracked mutex.
    ///
    /// # Arguments
    ///
    /// * `data` - The data to protect with the mutex
    /// * `client` - The Raceway client for tracking
    /// * `lock_id` - Unique identifier for this lock
    pub fn new(data: T, client: Arc<RacewayClient>, lock_id: impl Into<String>) -> Self {
        Self {
            inner: Mutex::new(data),
            client,
            lock_id: lock_id.into(),
        }
    }

    /// Lock the mutex, automatically tracking acquire and (on drop) release.
    ///
    /// Returns a guard that automatically tracks the lock release when dropped.
    pub fn lock(&self, lock_type: &str) -> TrackedMutexGuard<'_, T> {
        self.client.track_lock_acquire(&self.lock_id, lock_type);
        let guard = self.inner.lock().unwrap();
        TrackedMutexGuard {
            guard,
            client: self.client.clone(),
            lock_id: self.lock_id.clone(),
            lock_type: lock_type.to_string(),
        }
    }
}

/// RAII guard for a tracked mutex.
///
/// When this guard is dropped, the lock release is automatically tracked.
pub struct TrackedMutexGuard<'a, T> {
    guard: std::sync::MutexGuard<'a, T>,
    client: Arc<RacewayClient>,
    lock_id: String,
    lock_type: String,
}

impl<'a, T> Drop for TrackedMutexGuard<'a, T> {
    fn drop(&mut self) {
        self.client.track_lock_release(&self.lock_id, &self.lock_type);
    }
}

impl<'a, T> Deref for TrackedMutexGuard<'a, T> {
    type Target = T;

    fn deref(&self) -> &T {
        &*self.guard
    }
}

impl<'a, T> DerefMut for TrackedMutexGuard<'a, T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut *self.guard
    }
}

/// A wrapper around `std::sync::RwLock` that automatically tracks lock operations.
///
/// This provides the same API as `RwLock` but automatically calls Raceway's
/// lock tracking methods for both read and write locks.
pub struct TrackedRwLock<T> {
    inner: RwLock<T>,
    client: Arc<RacewayClient>,
    lock_id: String,
}

impl<T> TrackedRwLock<T> {
    /// Create a new tracked RwLock.
    ///
    /// # Arguments
    ///
    /// * `data` - The data to protect with the RwLock
    /// * `client` - The Raceway client for tracking
    /// * `lock_id` - Unique identifier for this lock
    pub fn new(data: T, client: Arc<RacewayClient>, lock_id: impl Into<String>) -> Self {
        Self {
            inner: RwLock::new(data),
            client,
            lock_id: lock_id.into(),
        }
    }

    /// Acquire a read lock, automatically tracking acquire and (on drop) release.
    pub fn read(&self) -> TrackedRwLockReadGuard<'_, T> {
        self.client.track_lock_acquire(&self.lock_id, "RwLock-Read");
        let guard = self.inner.read().unwrap();
        TrackedRwLockReadGuard {
            guard,
            client: self.client.clone(),
            lock_id: self.lock_id.clone(),
        }
    }

    /// Acquire a write lock, automatically tracking acquire and (on drop) release.
    pub fn write(&self) -> TrackedRwLockWriteGuard<'_, T> {
        self.client.track_lock_acquire(&self.lock_id, "RwLock-Write");
        let guard = self.inner.write().unwrap();
        TrackedRwLockWriteGuard {
            guard,
            client: self.client.clone(),
            lock_id: self.lock_id.clone(),
        }
    }
}

/// RAII guard for a tracked read lock.
pub struct TrackedRwLockReadGuard<'a, T> {
    guard: std::sync::RwLockReadGuard<'a, T>,
    client: Arc<RacewayClient>,
    lock_id: String,
}

impl<'a, T> Drop for TrackedRwLockReadGuard<'a, T> {
    fn drop(&mut self) {
        self.client.track_lock_release(&self.lock_id, "RwLock-Read");
    }
}

impl<'a, T> Deref for TrackedRwLockReadGuard<'a, T> {
    type Target = T;

    fn deref(&self) -> &T {
        &*self.guard
    }
}

/// RAII guard for a tracked write lock.
pub struct TrackedRwLockWriteGuard<'a, T> {
    guard: std::sync::RwLockWriteGuard<'a, T>,
    client: Arc<RacewayClient>,
    lock_id: String,
}

impl<'a, T> Drop for TrackedRwLockWriteGuard<'a, T> {
    fn drop(&mut self) {
        self.client.track_lock_release(&self.lock_id, "RwLock-Write");
    }
}

impl<'a, T> Deref for TrackedRwLockWriteGuard<'a, T> {
    type Target = T;

    fn deref(&self) -> &T {
        &*self.guard
    }
}

impl<'a, T> DerefMut for TrackedRwLockWriteGuard<'a, T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut *self.guard
    }
}
