"""
Python Banking API - Raceway Demo

This demonstrates how Raceway can detect race conditions in a Python/Flask banking API.

To run:
1. Start Raceway server: cd ../.. && cargo run --release -- serve
2. Install deps: pip3 install --break-system-packages -r requirements.txt
3. Start this server: python app.py
4. Open browser: http://localhost:3053
5. Click "Trigger Race Condition" to see the bug
6. View results: http://localhost:8080
"""

import os
import sys
import time
import threading

# Add SDK to path (in production, install via pip)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../sdks/python'))

from flask import Flask, request, jsonify, send_from_directory
from raceway import RacewayClient, Config
from raceway.middleware import flask_middleware


# Initialize Flask app and Raceway client
app = Flask(__name__)
raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="banking-api",
    debug=False,
))

# In-memory account database
accounts = {
    "alice": {"balance": 1000},
    "bob": {"balance": 500},
    "charlie": {"balance": 300},
}
accounts_lock = threading.RLock()

# Create Raceway middleware instance
middleware = flask_middleware(raceway)


# Use Raceway middleware
@app.before_request
def init_raceway():
    """Initialize Raceway context before each request."""
    middleware.before_request()


@app.after_request
def finish_raceway(response):
    """Finish Raceway tracking after each request."""
    return middleware.after_request(response)


@app.route("/")
def index():
    """Serve the web UI."""
    return send_from_directory("public", "index.html")


@app.route("/api/accounts", methods=["GET"])
def get_accounts():
    """Get all accounts."""
    raceway.track_function_call("get_accounts", {"endpoint": "/api/accounts"})

    with accounts_lock:
        return jsonify({"accounts": accounts})


@app.route("/api/balance/<account>", methods=["GET"])
def get_balance(account: str):
    """Get account balance."""
    raceway.track_function_call("get_balance", {"account": account})

    with accounts_lock:
        if account not in accounts:
            return jsonify({"error": "Account not found"}), 404

        balance = accounts[account]["balance"]
        raceway.track_state_change(
            f"{account}.balance",
            None,
            balance,
            "Read"
        )

        return jsonify(accounts[account])


@app.route("/api/transfer", methods=["POST"])
def transfer():
    """Transfer money (VULNERABLE TO RACE CONDITIONS!)."""
    data = request.get_json()
    from_account = data["from"]
    to_account = data["to"]
    amount = data["amount"]

    raceway.track_function_call("transfer", {
        "from": from_account,
        "to": to_account,
        "amount": amount,
    })

    # Validate accounts exist
    if from_account not in accounts or to_account not in accounts:
        return jsonify({"error": "Account not found"}), 404

    # Simulate some processing time (makes race conditions more likely)
    time.sleep(0.01)

    # READ: Get current balance (without holding lock - RACE CONDITION!)
    with accounts_lock:
        balance = accounts[from_account]["balance"]

    raceway.track_state_change(
        f"{from_account}.balance",
        None,
        balance,
        "Read"
    )

    print(f"[{from_account}] Read balance: {balance}")

    # Check sufficient funds
    if balance < amount:
        return jsonify({"error": "Insufficient funds"}), 400

    # Simulate more processing (window for race condition!)
    time.sleep(0.01)

    # WRITE: Update balance (RACE CONDITION HERE!)
    new_balance = balance - amount
    with accounts_lock:
        accounts[from_account]["balance"] = new_balance

    raceway.track_state_change(
        f"{from_account}.balance",
        balance,
        new_balance,
        "Write"
    )

    print(f"[{from_account}] Wrote balance: {new_balance}")

    # Credit the recipient
    with accounts_lock:
        old_to_balance = accounts[to_account]["balance"]
        accounts[to_account]["balance"] += amount

        raceway.track_state_change(
            f"{to_account}.balance",
            old_to_balance,
            accounts[to_account]["balance"],
            "Write"
        )

    return jsonify({
        "success": True,
        "from": {
            "account": from_account,
            "newBalance": accounts[from_account]["balance"],
        },
        "to": {
            "account": to_account,
            "newBalance": accounts[to_account]["balance"],
        },
    })


@app.route("/api/reset", methods=["POST"])
def reset_accounts():
    """Reset accounts to initial values."""
    raceway.track_function_call("reset_accounts", {})

    with accounts_lock:
        accounts["alice"] = {"balance": 1000}
        accounts["bob"] = {"balance": 500}
        accounts["charlie"] = {"balance": 300}

    return jsonify({
        "message": "Accounts reset",
        "accounts": accounts,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3053))

    print(f"\n💰 Banking API running on http://localhost:{port}")
    print("🔍 Raceway integration enabled")
    print(f"\n📊 Web UI: http://localhost:{port}")
    print("📊 Raceway Analysis: http://localhost:8080")
    print("\n🚨 Click \"Trigger Race Condition\" in the UI to see the bug!\n")

    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
