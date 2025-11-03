// Simplified transfer handler using plug-and-play SDK
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

    println!("[{}] Read balance: {}", req.from, balance);

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

    println!("[{}] Wrote balance: {}", req.from, new_balance);

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
