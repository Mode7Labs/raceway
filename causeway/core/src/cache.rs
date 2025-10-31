use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// A generic cache for query results with time-to-live (TTL) support
///
/// This cache stores a single value and automatically expires it after the configured TTL.
/// It's designed for expensive queries that are called frequently but don't need real-time data.
///
/// # Example
/// ```no_run
/// use raceway_core::cache::QueryCache;
/// use std::time::Duration;
///
/// async fn expensive_query() -> Result<Vec<String>, String> {
///     // Simulate expensive operation
///     Ok(vec!["result".to_string()])
/// }
///
/// # async fn example() -> Result<(), String> {
/// let cache = QueryCache::new(Duration::from_secs(60));
///
/// // First call hits the database
/// let result1 = cache.get_or_fetch(|| Box::pin(expensive_query())).await?;
///
/// // Second call returns cached value (if within TTL)
/// let result2 = cache.get_or_fetch(|| Box::pin(expensive_query())).await?;
/// # Ok(())
/// # }
/// ```
pub struct QueryCache<T> {
    value: Arc<RwLock<Option<CachedValue<T>>>>,
    ttl: Duration,
}

struct CachedValue<T> {
    data: T,
    expires_at: Instant,
}

impl<T: Clone> QueryCache<T> {
    /// Create a new query cache with the specified time-to-live
    ///
    /// # Arguments
    /// * `ttl` - How long cached values remain valid
    ///
    /// # Example
    /// ```
    /// use raceway_core::cache::QueryCache;
    /// use std::time::Duration;
    ///
    /// // Cache values for 60 seconds
    /// let cache: QueryCache<Vec<String>> = QueryCache::new(Duration::from_secs(60));
    /// ```
    pub fn new(ttl: Duration) -> Self {
        Self {
            value: Arc::new(RwLock::new(None)),
            ttl,
        }
    }

    /// Get a value from the cache, or fetch it if expired/missing
    ///
    /// This method first checks if a cached value exists and is still valid.
    /// If not, it calls the provided fetch function and caches the result.
    ///
    /// # Arguments
    /// * `fetch_fn` - Async function that fetches the data if cache miss
    ///
    /// # Returns
    /// The cached or freshly fetched value
    ///
    /// # Example
    /// ```no_run
    /// # use raceway_core::cache::QueryCache;
    /// # use std::time::Duration;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let cache = QueryCache::new(Duration::from_secs(30));
    ///
    /// let data = cache.get_or_fetch(|| {
    ///     Box::pin(async {
    ///         // Expensive database query
    ///         Ok::<_, Box<dyn std::error::Error>>(vec![1, 2, 3])
    ///     })
    /// }).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_or_fetch<F, Fut, E>(&self, fetch_fn: F) -> Result<T, E>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
    {
        // Check cache first (read lock)
        {
            let cache = self.value.read().await;
            if let Some(cached) = cache.as_ref() {
                if cached.expires_at > Instant::now() {
                    return Ok(cached.data.clone());
                }
            }
        }

        // Cache miss - fetch fresh data
        let data = fetch_fn().await?;

        // Update cache (write lock)
        {
            let mut cache = self.value.write().await;
            *cache = Some(CachedValue {
                data: data.clone(),
                expires_at: Instant::now() + self.ttl,
            });
        }

        Ok(data)
    }

    /// Manually invalidate the cache
    ///
    /// Forces the next `get_or_fetch` call to fetch fresh data
    ///
    /// # Example
    /// ```
    /// # use raceway_core::cache::QueryCache;
    /// # use std::time::Duration;
    /// # async fn example() {
    /// let cache: QueryCache<Vec<String>> = QueryCache::new(Duration::from_secs(60));
    ///
    /// // Clear the cache
    /// cache.invalidate().await;
    /// # }
    /// ```
    pub async fn invalidate(&self) {
        let mut cache = self.value.write().await;
        *cache = None;
    }

    /// Check if the cache currently holds a valid value
    ///
    /// # Returns
    /// `true` if cache contains unexpired data, `false` otherwise
    pub async fn is_valid(&self) -> bool {
        let cache = self.value.read().await;
        if let Some(cached) = cache.as_ref() {
            cached.expires_at > Instant::now()
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn test_cache_returns_cached_value() {
        let cache = QueryCache::new(Duration::from_secs(10));
        let call_count = Arc::new(AtomicUsize::new(0));

        // First call should hit the fetch function
        let count_clone = call_count.clone();
        let result1 = cache
            .get_or_fetch(|| async move {
                count_clone.fetch_add(1, Ordering::SeqCst);
                Ok::<_, String>(vec!["data".to_string()])
            })
            .await
            .unwrap();
        assert_eq!(call_count.load(Ordering::SeqCst), 1);
        assert_eq!(result1, vec!["data".to_string()]);

        // Second call should return cached value
        let count_clone = call_count.clone();
        let result2 = cache
            .get_or_fetch(|| async move {
                count_clone.fetch_add(1, Ordering::SeqCst);
                Ok::<_, String>(vec!["data".to_string()])
            })
            .await
            .unwrap();
        assert_eq!(call_count.load(Ordering::SeqCst), 1); // Still 1, not 2
        assert_eq!(result2, vec!["data".to_string()]);
    }

    #[tokio::test]
    async fn test_cache_expires() {
        let cache = QueryCache::new(Duration::from_millis(100));
        let call_count = Arc::new(AtomicUsize::new(0));

        // First call
        let count_clone = call_count.clone();
        let result1 = cache
            .get_or_fetch(|| {
                let count = count_clone.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, String>(count.load(Ordering::SeqCst))
                }
            })
            .await
            .unwrap();
        assert_eq!(result1, 1);
        assert_eq!(call_count.load(Ordering::SeqCst), 1);

        // Wait for cache to expire
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Should fetch fresh data after TTL
        let count_clone = call_count.clone();
        let result2 = cache
            .get_or_fetch(|| {
                let count = count_clone.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, String>(count.load(Ordering::SeqCst))
                }
            })
            .await
            .unwrap();
        assert_eq!(result2, 2);
        assert_eq!(call_count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn test_cache_invalidation() {
        let cache = QueryCache::new(Duration::from_secs(10));
        let call_count = Arc::new(AtomicUsize::new(0));

        // First call
        let count_clone = call_count.clone();
        let result1 = cache
            .get_or_fetch(|| {
                let count = count_clone.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, String>(count.load(Ordering::SeqCst))
                }
            })
            .await
            .unwrap();
        assert_eq!(result1, 1);

        // Manually invalidate
        cache.invalidate().await;

        // Should fetch fresh data even though TTL not expired
        let count_clone = call_count.clone();
        let result2 = cache
            .get_or_fetch(|| {
                let count = count_clone.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, String>(count.load(Ordering::SeqCst))
                }
            })
            .await
            .unwrap();
        assert_eq!(result2, 2);
        assert_eq!(call_count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn test_is_valid() {
        let cache = QueryCache::new(Duration::from_millis(100));

        // Initially invalid (no data)
        assert!(!cache.is_valid().await);

        // Fetch data
        cache
            .get_or_fetch(|| async { Ok::<_, String>("data".to_string()) })
            .await
            .unwrap();

        // Should be valid
        assert!(cache.is_valid().await);

        // Wait for expiry
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Should be invalid
        assert!(!cache.is_valid().await);
    }

    #[tokio::test]
    async fn test_concurrent_access() {
        let cache = Arc::new(QueryCache::new(Duration::from_secs(10)));
        let call_count = Arc::new(AtomicUsize::new(0));

        // First, prime the cache with a value
        let count_clone = call_count.clone();
        cache
            .get_or_fetch(|| {
                let count = count_clone.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, String>(vec!["data".to_string()])
                }
            })
            .await
            .unwrap();

        assert_eq!(call_count.load(Ordering::SeqCst), 1);

        // Now spawn multiple concurrent requests - all should hit the cache
        let mut handles = vec![];
        for _ in 0..10 {
            let cache_clone = cache.clone();
            let count_clone = call_count.clone();
            let handle = tokio::spawn(async move {
                cache_clone
                    .get_or_fetch(|| {
                        let count = count_clone.clone();
                        async move {
                            count.fetch_add(1, Ordering::SeqCst);
                            Ok::<_, String>(vec!["data".to_string()])
                        }
                    })
                    .await
                    .unwrap()
            });
            handles.push(handle);
        }

        // Wait for all to complete
        for handle in handles {
            handle.await.unwrap();
        }

        // All should have used the cached value (no additional fetches)
        assert_eq!(
            call_count.load(Ordering::SeqCst),
            1,
            "Cache should serve all concurrent requests"
        );
    }

    #[tokio::test]
    async fn test_error_handling() {
        let cache = QueryCache::new(Duration::from_secs(10));
        let call_count = Arc::new(AtomicUsize::new(0));

        // Error should propagate
        let count_clone = call_count.clone();
        let result = cache
            .get_or_fetch(|| {
                let count = count_clone.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Err::<Vec<String>, _>("Database error")
                }
            })
            .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Database error");

        // Should not cache errors - next call should try again
        let count_clone = call_count.clone();
        let result2 = cache
            .get_or_fetch(|| {
                let count = count_clone.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Err::<Vec<String>, _>("Database error")
                }
            })
            .await;
        assert!(result2.is_err());
        assert_eq!(call_count.load(Ordering::SeqCst), 2);
    }
}
