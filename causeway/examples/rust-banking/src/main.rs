/*!
# Rust Banking API - Raceway Demo

This demonstrates how Raceway can detect race conditions in a Rust/Axum banking API.

To run:
1. Start Raceway server: cd ../.. && cargo run --release -- serve
2. Start this server: cargo run --release
3. Open browser: http://localhost:3051
4. Click "Trigger Race Condition" to see the bug
5. View results: http://localhost:8080
*/

use axum::{
    extract::Path,
    extract::State,
    http::StatusCode,
    middleware::{self},
    response::Json,
    routing::{get, post},
    Router,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::time::{sleep, Duration};
use tower_http::services::ServeDir;


// Use actual Raceway SDK
use raceway_sdk::RacewayClient;


// Application state
#[derive(Clone)]
struct AppState {
    accounts: Arc<RwLock<HashMap<String, Account>>>,
    raceway: Arc<RacewayClient>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Account {
    balance: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct TransferRequest {
    from: String,
    to: String,
    amount: i64,
}

#[derive(Debug, Serialize)]
struct TransferResponse {
    success: bool,
    from: AccountInfo,
    to: AccountInfo,
}

#[derive(Debug, Serialize)]
struct AccountInfo {
    account: String,
    #[serde(rename = "newBalance")]
    new_balance: i64,
}

#[derive(Debug, Serialize)]
struct AccountsResponse {
    accounts: HashMap<String, Account>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[tokio::main]
async fn main() {
    // Initialize state
    let mut accounts = HashMap::new();
    accounts.insert("alice".to_string(), Account { balance: 1000 });
    accounts.insert("bob".to_string(), Account { balance: 500 });
    accounts.insert("charlie".to_string(), Account { balance: 300 });

    let raceway = Arc::new(RacewayClient::new("http://localhost:8080", "banking-api"));

    let state = AppState {
        accounts: Arc::new(RwLock::new(accounts)),
        raceway: raceway.clone(),
    };

    // Build router with Raceway middleware for automatic trace context
    let app = Router::new()
        .route("/api/accounts", get(get_accounts))
        .route("/api/balance/:account", get(get_balance))
        .route("/api/transfer", post(transfer))
        .route("/api/reset", post(reset_accounts))
        .layer(middleware::from_fn(move |headers, request, next| {
            let client = raceway.clone();
            async move {
                RacewayClient::middleware(client, headers, request, next).await
            }
        }))
        .nest_service("/", ServeDir::new("public"))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3051".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();

    println!("\n💰 Banking API running on http://localhost:{}", port);
    println!("🔍 Raceway integration enabled");
    println!("\n📊 Web UI: http://localhost:{}", port);
    println!("📊 Raceway Analysis: http://localhost:8080");
    println!("\n🚨 Click \"Trigger Race Condition\" in the UI to see the bug!\n");

    axum::serve(listener, app).await.unwrap();
}

async fn get_accounts(State(state): State<AppState>) -> Json<AccountsResponse> {
    state.raceway.track_function_call("get_accounts", serde_json::json!({}));
    let accounts = state.accounts.read().clone();
    state.raceway.track_http_response(200, 0);

    Json(AccountsResponse { accounts })
}

async fn get_balance(
    State(state): State<AppState>,
    Path(account): Path<String>,
) -> Result<Json<Account>, (StatusCode, Json<ErrorResponse>)> {
    state.raceway.track_function_call("get_balance", serde_json::json!({ "account": &account }));

    let accounts = state.accounts.read();
    let account_data = accounts.get(&account).cloned();

    if let Some(acc) = account_data {
        state.raceway.track_state_change(&format!("{}.balance", account), None::<i64>, acc.balance, "Read");
        state.raceway.track_http_response(200, 0);
        Ok(Json(acc))
    } else {
        state.raceway.track_http_response(404, 0);
        Err((StatusCode::NOT_FOUND, Json(ErrorResponse { error: "Account not found".to_string() })))
    }
}

async fn transfer(
    State(state): State<AppState>,
    Json(req): Json<TransferRequest>,
) -> Result<Json<TransferResponse>, (StatusCode, Json<ErrorResponse>)> {
    let start = Instant::now();

    // Track function call - SDK auto-manages trace context
    state.raceway.track_function_call(
        "transfer",
        serde_json::json!({ "from": &req.from, "to": &req.to, "amount": req.amount }),
    );

    // Simulate some processing time (makes race conditions more likely)
    sleep(Duration::from_millis(10)).await;

    // READ: Get current balance (without holding lock - RACE CONDITION!)
    let current_balance = {
        let accounts = state.accounts.read();
        accounts.get(&req.from).map(|a| a.balance)
    };

    let Some(balance) = current_balance else {
        state.raceway.track_http_response(404, start.elapsed().as_millis() as u64);
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Account not found".to_string(),
            }),
        ));
    };

    // Track the READ - SDK auto-captures location via file!() and line!()
    state.raceway.track_state_change(
        &format!("{}.balance", req.from),
        None::<i64>,
        balance,
        "Read",
    );

    // Check sufficient funds
    if balance < req.amount {
        state.raceway.track_http_response(400, start.elapsed().as_millis() as u64);
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Insufficient funds".to_string(),
            }),
        ));
    }

    // Simulate more processing (window for race condition!)
    sleep(Duration::from_millis(10)).await;

    // WRITE: Update balance (RACE CONDITION HERE!)
    let new_balance = balance - req.amount;
    {
        let mut accounts = state.accounts.write();
        if let Some(account) = accounts.get_mut(&req.from) {
            account.balance = new_balance;
        }
    }

    // Track the WRITE - SDK auto-captures location
    state.raceway.track_state_change(
        &format!("{}.balance", req.from),
        Some(balance),
        new_balance,
        "Write",
    );

    // Credit the recipient
    let to_balance = {
        let mut accounts = state.accounts.write();
        if let Some(account) = accounts.get_mut(&req.to) {
            let old = account.balance;
            account.balance += req.amount;

            // Track recipient balance change
            state.raceway.track_state_change(
                &format!("{}.balance", req.to),
                Some(old),
                account.balance,
                "Write",
            );

            account.balance
        } else {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Recipient account not found".to_string(),
                }),
            ));
        }
    };

    state.raceway.track_http_response(200, start.elapsed().as_millis() as u64);

    Ok(Json(TransferResponse {
        success: true,
        from: AccountInfo {
            account: req.from.clone(),
            new_balance,
        },
        to: AccountInfo {
            account: req.to.clone(),
            new_balance: to_balance,
        },
    }))
}

async fn reset_accounts(State(state): State<AppState>) -> Json<serde_json::Value> {
    state.raceway.track_function_call("reset_accounts", serde_json::json!({}));

    let mut accounts = state.accounts.write();
    accounts.insert("alice".to_string(), Account { balance: 1000 });
    accounts.insert("bob".to_string(), Account { balance: 500 });
    accounts.insert("charlie".to_string(), Account { balance: 300 });

    state.raceway.track_http_response(200, 0);

    Json(serde_json::json!({"message": "Accounts reset", "accounts": *accounts}))
}
