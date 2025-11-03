use anyhow::{Context, Result};
use axum::{body::Body, http::Request, Router};
use http_body_util::BodyExt;
use raceway::server::{build_router, init_engine};
use raceway_core::{Config, RacewayEngine};
use std::sync::Arc;
use tower::ServiceExt;

pub struct TestApp {
    router: Router,
    _engine: Arc<RacewayEngine>,
}

impl TestApp {
    pub async fn new(mut config: Config) -> Result<Self> {
        config.server.cors_enabled = false;
        config.server.verbose = false;
        config.storage.backend = "memory".into();
        config.engine.flush_interval_ms = 10;

        let engine = init_engine(&config).await?;
        let router = build_router(&config, Arc::clone(&engine));

        Ok(Self {
            router,
            _engine: engine,
        })
    }

    pub async fn post_json(
        &self,
        path: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let body = Body::from(serde_json::to_vec(&payload)?);
        let request = Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .body(body)?;

        self.execute(request).await
    }

    pub async fn get_json(&self, path: &str) -> Result<serde_json::Value> {
        let request = Request::builder()
            .method("GET")
            .uri(path)
            .body(Body::empty())?;

        self.execute(request).await
    }

    async fn execute(&self, request: Request<Body>) -> Result<serde_json::Value> {
        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .context("router execution failed")?;

        if !response.status().is_success() {
            anyhow::bail!("request failed with status {}", response.status());
        }

        let bytes = response.into_body().collect().await?.to_bytes();
        Ok(serde_json::from_slice(&bytes)?)
    }
}
